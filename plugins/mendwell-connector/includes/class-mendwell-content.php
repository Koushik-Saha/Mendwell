<?php
/**
 * Targeted HTML edits via WP_HTML_Tag_Processor (WP 6.2+): change one attribute on matching
 * tags and leave every other byte of the post exactly as it was.
 *
 * @package MendwellConnector
 */

defined( 'ABSPATH' ) || exit;

final class Mendwell_Content {
	/** Does this <img> belong to the attachment (class wp-image-ID, or the attachment's file)? */
	private static function img_matches( WP_HTML_Tag_Processor $p, $attachment_id, $file_stem ) {
		$class = $p->get_attribute( 'class' );
		if ( is_string( $class ) && preg_match( '/(^|\s)wp-image-' . (int) $attachment_id . '(\s|$)/', $class ) ) {
			return true;
		}
		$src = $p->get_attribute( 'src' );
		if ( ! is_string( $src ) || '' === $file_stem ) {
			return false;
		}
		// Sized copies look like photo-300x200.jpg; compare against the original's stem.
		$name = preg_replace( '/-\d+x\d+(?=\.[a-z0-9]+$)/i', '', wp_basename( (string) wp_parse_url( $src, PHP_URL_PATH ) ) );
		return $name === $file_stem;
	}

	/** File name of the attachment (e.g. "photo.jpg"), used to match classic <img> tags by src. */
	public static function file_stem( $attachment_id ) {
		$file = get_post_meta( $attachment_id, '_wp_attached_file', true );
		return is_string( $file ) && '' !== $file ? wp_basename( $file ) : '';
	}

	public static function references_attachment( $html, $attachment_id ) {
		$p    = new WP_HTML_Tag_Processor( (string) $html );
		$stem = self::file_stem( $attachment_id );
		while ( $p->next_tag( 'img' ) ) {
			if ( self::img_matches( $p, $attachment_id, $stem ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Set alt on every <img> of this attachment: core/image blocks and classic-editor images alike.
	 *
	 * @return array{0:string,1:int} Updated HTML and number of images changed.
	 */
	public static function set_img_alt( $html, $attachment_id, $alt ) {
		$p       = new WP_HTML_Tag_Processor( (string) $html );
		$stem    = self::file_stem( $attachment_id );
		$changed = 0;
		while ( $p->next_tag( 'img' ) ) {
			if ( self::img_matches( $p, $attachment_id, $stem ) && $p->get_attribute( 'alt' ) !== $alt ) {
				$p->set_attribute( 'alt', $alt ); // the processor escapes the value
				++$changed;
			}
		}
		return array( $p->get_updated_html(), $changed );
	}

	/** @return array{0:string,1:int} Updated HTML and number of links changed. */
	public static function replace_href( $html, $old_href, $new_href ) {
		$p       = new WP_HTML_Tag_Processor( (string) $html );
		$changed = 0;
		while ( $p->next_tag( 'a' ) ) {
			if ( $p->get_attribute( 'href' ) === $old_href ) {
				$p->set_attribute( 'href', $new_href );
				++$changed;
			}
		}
		return array( $p->get_updated_html(), $changed );
	}

	public static function has_href( $html, $href ) {
		$p = new WP_HTML_Tag_Processor( (string) $html );
		while ( $p->next_tag( 'a' ) ) {
			if ( $p->get_attribute( 'href' ) === $href ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Save post_content through wp_update_post (so WordPress keeps a revision) without letting kses
	 * rewrite the post: our REST requests have no logged-in user, and kses would otherwise strip
	 * markup the owner legitimately added (embeds, iframes). We only ever change an attribute
	 * value, escaped by the tag processor.
	 *
	 * @return true|WP_Error
	 */
	public static function save_content( $post_id, $content ) {
		$filters  = array( 'content_save_pre', 'content_filtered_save_pre' );
		$restored = array();
		foreach ( $filters as $filter ) {
			if ( has_filter( $filter, 'wp_filter_post_kses' ) ) {
				remove_filter( $filter, 'wp_filter_post_kses' );
				$restored[] = $filter;
			}
		}
		try {
			$result = wp_update_post( array( 'ID' => (int) $post_id, 'post_content' => wp_slash( $content ) ), true );
		} finally {
			foreach ( $restored as $filter ) {
				add_filter( $filter, 'wp_filter_post_kses' );
			}
		}
		return is_wp_error( $result ) ? $result : true;
	}
}
