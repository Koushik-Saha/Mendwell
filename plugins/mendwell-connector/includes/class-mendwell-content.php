<?php
/**
 * Targeted HTML edits via WP_HTML_Tag_Processor (WP 6.2+): change one attribute on matching
 * tags and leave every other byte of the post exactly as it was.
 *
 * @package MendwellConnector
 */

defined( 'ABSPATH' ) || exit;

final class Mendwell_Content {

	/** Bytes of unchanged text either side of a write that undo must still find around it. */
	const UNDO_CONTEXT = 60;
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
	 * Reverse one write to a post without touching anything else in it. A write changes one region
	 * (between the longest common prefix and suffix of before/after); undo looks for that region, as
	 * the write left it and with a little of its surroundings, exactly once in the current content,
	 * and puts the old region back. Other fixes or edits elsewhere in the post are kept. If the
	 * region itself changed (or can't be found unambiguously), returns null: a conflict.
	 *
	 * @param string $current Post content now.
	 * @param string $before  Post content before the write.
	 * @param string $after   Post content the write left.
	 * @return string|null
	 */
	public static function undo_region( $current, $before, $after ) {
		if ( $current === $after ) {
			return $before;
		}
		$before_len = strlen( $before );
		$after_len  = strlen( $after );
		$max        = min( $before_len, $after_len );
		$prefix     = 0;
		while ( $prefix < $max && $before[ $prefix ] === $after[ $prefix ] ) {
			++$prefix;
		}
		$suffix = 0;
		while ( $suffix < $max - $prefix && $before[ $before_len - 1 - $suffix ] === $after[ $after_len - 1 - $suffix ] ) {
			++$suffix;
		}
		$lead    = substr( $after, max( 0, $prefix - self::UNDO_CONTEXT ), min( $prefix, self::UNDO_CONTEXT ) );
		$trail   = substr( $after, $after_len - $suffix, min( $suffix, self::UNDO_CONTEXT ) );
		$search  = $lead . substr( $after, $prefix, $after_len - $suffix - $prefix ) . $trail;
		$replace = $lead . substr( $before, $prefix, $before_len - $suffix - $prefix ) . $trail;
		if ( '' === $search || 1 !== substr_count( $current, $search ) ) {
			return null;
		}
		$at = strpos( $current, $search );
		return substr( $current, 0, $at ) . $replace . substr( $current, $at + strlen( $search ) );
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
