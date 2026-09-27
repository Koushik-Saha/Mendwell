<?php
/**
 * The only code that changes the site. Every write (PROJECT_SPEC §8.3):
 *   1. refuses while paused,
 *   2. checks the value Mendwell expects is still there (optimistic concurrency),
 *   3. logs before/after in {prefix}mendwell_log,
 *   4. goes through core APIs (update_post_meta, wp_update_post → revisions).
 * Nothing else: no files, no SQL, no users, no plugins, no options besides our own.
 *
 * @package MendwellConnector
 */

defined( 'ABSPATH' ) || exit;

final class Mendwell_Writer {
	const ALT_MAX   = 300;
	const TITLE_MAX = 200;
	const DESC_MAX  = 400;
	const ALT_KEY   = '_wp_attachment_image_alt';

	private static function paused() {
		return new WP_Error( 'mendwell_paused', 'Changes are paused on this site.', array( 'status' => 423 ) );
	}

	private static function conflict( array $fields ) {
		return new WP_Error(
			'mendwell_conflict',
			'The site changed since Mendwell last looked, so nothing was written.',
			array( 'status' => 409, 'fields' => $fields )
		);
	}

	private static function invalid( $message ) {
		return new WP_Error( 'mendwell_invalid', $message, array( 'status' => 422 ) );
	}

	/** Plain text only: no tags, no line breaks, collapsed whitespace. */
	private static function clean_text( $value, $max ) {
		$clean = sanitize_text_field( (string) $value );
		return mb_strlen( $clean ) > $max ? null : $clean;
	}

	/**
	 * Alt text for an image: the media library field, plus every published post that shows the
	 * image (core/image blocks and classic <img>), so the fix is visible where the issue was found.
	 *
	 * @return array|WP_Error
	 */
	public static function fix_alt( $fix_id, $attachment_id, $value, $expected_current ) {
		if ( Mendwell_State::is_paused() ) {
			return self::paused();
		}
		$attachment_id = (int) $attachment_id;
		if ( 'attachment' !== get_post_type( $attachment_id ) || ! wp_attachment_is_image( $attachment_id ) ) {
			return new WP_Error( 'mendwell_not_found', 'That image was not found.', array( 'status' => 404 ) );
		}
		$alt = self::clean_text( $value, self::ALT_MAX );
		if ( null === $alt ) {
			return self::invalid( 'Alt text is too long.' );
		}
		$current = (string) get_post_meta( $attachment_id, self::ALT_KEY, true );
		if ( (string) $expected_current !== $current ) {
			return self::conflict( array( 'alt' => $current ) );
		}

		$log_ids = array();
		update_post_meta( $attachment_id, self::ALT_KEY, wp_slash( $alt ) ); // update_post_meta unslashes
		$log_ids[] = Mendwell_Log::record( $fix_id, 'attachment', $attachment_id, self::ALT_KEY, $current, $alt );

		$posts_updated = 0;
		foreach ( Mendwell_Resolver::media_usage( $attachment_id ) as $usage ) {
			$before = (string) get_post_field( 'post_content', $usage['id'], 'raw' );
			list( $after, $changed ) = Mendwell_Content::set_img_alt( $before, $attachment_id, $alt );
			if ( 0 === $changed ) {
				continue;
			}
			$saved = Mendwell_Content::save_content( $usage['id'], $after );
			if ( is_wp_error( $saved ) ) {
				continue; // the media library value is set; the post keeps its old alt and verification will say so
			}
			$log_ids[] = Mendwell_Log::record( $fix_id, 'post', $usage['id'], 'post_content', $before, $after );
			++$posts_updated;
		}
		return array( 'logIds' => $log_ids, 'postsUpdated' => $posts_updated, 'value' => $alt );
	}

	/**
	 * Meta title and/or description, in the active SEO plugin's fields (or our own when there is none).
	 *
	 * @param array{title?:string,description?:string} $expected_current
	 * @return array|WP_Error
	 */
	public static function fix_meta( $fix_id, $post_id, $title, $description, array $expected_current ) {
		if ( Mendwell_State::is_paused() ) {
			return self::paused();
		}
		$post_id = (int) $post_id;
		$post    = get_post( $post_id );
		if ( ! $post || 'publish' !== $post->post_status ) {
			return new WP_Error( 'mendwell_not_found', 'That page was not found.', array( 'status' => 404 ) );
		}
		$plugin = Mendwell_Seo::detect();
		$keys   = Mendwell_Seo::meta_keys( $plugin );
		if ( null === $keys ) {
			return new WP_Error( 'mendwell_unsupported_seo_plugin', 'This site uses an SEO plugin Mendwell does not write to.', array( 'status' => 422 ) );
		}

		$changes = array();
		foreach ( array( 'title' => array( $title, self::TITLE_MAX ), 'description' => array( $description, self::DESC_MAX ) ) as $field => $spec ) {
			if ( null === $spec[0] ) {
				continue;
			}
			$clean = self::clean_text( $spec[0], $spec[1] );
			if ( null === $clean || '' === $clean ) {
				return self::invalid( "The {$field} is empty or too long." );
			}
			$changes[ $field ] = $clean;
		}
		if ( empty( $changes ) ) {
			return self::invalid( 'Nothing to change.' );
		}

		$conflicts = array();
		foreach ( $changes as $field => $unused ) {
			$current = (string) get_post_meta( $post_id, $keys[ $field ], true );
			if ( (string) ( isset( $expected_current[ $field ] ) ? $expected_current[ $field ] : '' ) !== $current ) {
				$conflicts[ $field ] = $current;
			}
		}
		if ( $conflicts ) {
			return self::conflict( $conflicts );
		}

		$log_ids = array();
		foreach ( $changes as $field => $value ) {
			$before = (string) get_post_meta( $post_id, $keys[ $field ], true );
			update_post_meta( $post_id, $keys[ $field ], wp_slash( $value ) );
			$log_ids[] = Mendwell_Log::record( $fix_id, 'post', $post_id, $keys[ $field ], $before, $value );
		}
		return array( 'logIds' => $log_ids, 'seoPlugin' => $plugin );
	}

	/**
	 * Point a broken link somewhere that works: replace the href in the post's content.
	 *
	 * @return array|WP_Error
	 */
	public static function fix_link( $fix_id, $post_id, $old_href, $new_href ) {
		if ( Mendwell_State::is_paused() ) {
			return self::paused();
		}
		$post_id = (int) $post_id;
		$post    = get_post( $post_id );
		if ( ! $post || 'publish' !== $post->post_status ) {
			return new WP_Error( 'mendwell_not_found', 'That page was not found.', array( 'status' => 404 ) );
		}
		$new_href = esc_url_raw( (string) $new_href, array( 'http', 'https' ) );
		if ( '' === $new_href || '' === (string) $old_href ) {
			return self::invalid( 'Both the old and the new link are required, and the new one must be http(s).' );
		}
		$before = (string) $post->post_content;
		if ( ! Mendwell_Content::has_href( $before, (string) $old_href ) ) {
			return self::conflict( array( 'href' => 'not found' ) );
		}
		list( $after, $changed ) = Mendwell_Content::replace_href( $before, (string) $old_href, $new_href );
		$saved = Mendwell_Content::save_content( $post_id, $after );
		if ( is_wp_error( $saved ) ) {
			return new WP_Error( 'mendwell_save_failed', 'WordPress could not save the post.', array( 'status' => 500 ) );
		}
		$log_id = Mendwell_Log::record( $fix_id, 'post', $post_id, 'post_content', $before, $after );
		return array( 'logIds' => array( $log_id ), 'linksChanged' => $changed );
	}

	private static function read( $row ) {
		if ( 'post_content' === $row->field ) {
			return (string) get_post_field( 'post_content', (int) $row->object_id, 'raw' );
		}
		return (string) get_post_meta( (int) $row->object_id, $row->field, true );
	}

	private static function restore( $row ) {
		if ( 'post_content' === $row->field ) {
			return Mendwell_Content::save_content( (int) $row->object_id, $row->before_value );
		}
		update_post_meta( (int) $row->object_id, $row->field, wp_slash( $row->before_value ) );
		return true;
	}

	/**
	 * Undo a fix: restore every before-value, but only if each field still holds exactly what
	 * Mendwell wrote. If anyone changed it since, nothing is touched (409): we never overwrite a
	 * human's edit.
	 *
	 * @param bool $respect_pause False when a site admin undoes from WP admin, which is always allowed.
	 * @return array|WP_Error
	 */
	public static function undo( $fix_id, $respect_pause = true ) {
		if ( $respect_pause && Mendwell_State::is_paused() ) {
			return self::paused();
		}
		$rows = Mendwell_Log::for_fix( $fix_id );
		if ( empty( $rows ) ) {
			return new WP_Error( 'mendwell_not_found', 'There is nothing to undo for that fix.', array( 'status' => 404 ) );
		}
		$conflicts = array();
		foreach ( $rows as $row ) {
			if ( self::read( $row ) !== (string) $row->after_value ) {
				$conflicts[] = array( 'objectId' => (int) $row->object_id, 'field' => $row->field );
			}
		}
		if ( $conflicts ) {
			return self::conflict( $conflicts );
		}
		foreach ( $rows as $row ) { // newest first, so overlapping edits unwind in order
			$restored = self::restore( $row );
			if ( is_wp_error( $restored ) ) {
				return new WP_Error( 'mendwell_save_failed', 'WordPress could not restore the post.', array( 'status' => 500 ) );
			}
		}
		Mendwell_Log::mark_undone( wp_list_pluck( $rows, 'id' ) );
		return array( 'restored' => count( $rows ) );
	}
}
