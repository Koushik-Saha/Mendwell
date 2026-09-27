<?php
/**
 * Read-only lookups: where an image is used, and where a broken internal path should point
 * (PROJECT_SPEC §5.3: old slug → existing redirect → exactly one matching slug; otherwise ask a human).
 *
 * @package MendwellConnector
 */

defined( 'ABSPATH' ) || exit;

final class Mendwell_Resolver {
	const MAX_USAGE = 200;

	private static function public_types() {
		return array_values( get_post_types( array( 'public' => true ) ) );
	}

	/** @return array<int,array{id:int,type:string,title:string,url:string}> Published posts showing the image. */
	public static function media_usage( $attachment_id ) {
		global $wpdb;
		$attachment_id = (int) $attachment_id;
		$stem          = Mendwell_Content::file_stem( $attachment_id );
		$types         = self::public_types();
		$placeholders  = implode( ',', array_fill( 0, count( $types ), '%s' ) );
		$params        = array_merge(
			array( $wpdb->posts ),
			$types,
			array( '%' . $wpdb->esc_like( 'wp-image-' . $attachment_id ) . '%', '%' . $wpdb->esc_like( '' !== $stem ? pathinfo( $stem, PATHINFO_FILENAME ) : 'wp-image-' . $attachment_id ) . '%', self::MAX_USAGE )
		);
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQLPlaceholders
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT ID, post_type, post_title, post_content FROM %i WHERE post_status = 'publish' AND post_type IN ($placeholders) AND (post_content LIKE %s OR post_content LIKE %s) LIMIT %d", $params ) );

		$usage = array();
		foreach ( $rows as $row ) {
			// LIKE is only a prefilter (wp-image-1 also matches wp-image-12); confirm on the parsed HTML.
			if ( Mendwell_Content::references_attachment( $row->post_content, $attachment_id ) ) {
				$usage[] = array( 'id' => (int) $row->ID, 'type' => $row->post_type, 'title' => $row->post_title, 'url' => (string) get_permalink( (int) $row->ID ) );
			}
		}
		return $usage;
	}

	/**
	 * @return array{resolved:?string,source:?string,candidates:array<int,array{url:string,source:string}>}
	 */
	public static function resolve_path( $path ) {
		global $wpdb;
		$path = '/' . ltrim( (string) wp_parse_url( (string) $path, PHP_URL_PATH ), '/' );
		$slug = sanitize_title( wp_basename( untrailingslashit( $path ) ) );
		$out  = array( 'resolved' => null, 'source' => null, 'candidates' => array() );
		if ( '' === $slug ) {
			return $out;
		}
		$types        = self::public_types();
		$placeholders = implode( ',', array_fill( 0, count( $types ), '%s' ) );

		// (a) WordPress remembers old slugs when a post is renamed.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQLPlaceholders
		$old = $wpdb->get_col( $wpdb->prepare( "SELECT p.ID FROM %i p JOIN %i m ON m.post_id = p.ID WHERE m.meta_key = '_wp_old_slug' AND m.meta_value = %s AND p.post_status = 'publish' AND p.post_type IN ($placeholders) LIMIT 5", array_merge( array( $wpdb->posts, $wpdb->postmeta, $slug ), $types ) ) );
		$old_urls = array_values( array_unique( array_map( 'get_permalink', array_map( 'intval', $old ) ) ) );

		// (b) An existing redirect from the Redirection plugin, if it's installed.
		$redirect_urls = array();
		$table         = $wpdb->prefix . 'redirection_items';
		if ( $table === $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$redirect_urls = array_values( array_unique( $wpdb->get_col( $wpdb->prepare( "SELECT action_data FROM %i WHERE url IN (%s, %s) AND status = 'enabled' AND action_type = 'url' LIMIT 5", $table, untrailingslashit( $path ), trailingslashit( $path ) ) ) ) );
		}

		// (c) Published posts whose slug is the last path segment.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQLPlaceholders
		$same = $wpdb->get_col( $wpdb->prepare( "SELECT ID FROM %i WHERE post_name = %s AND post_status = 'publish' AND post_type IN ($placeholders) LIMIT 5", array_merge( array( $wpdb->posts, $slug ), $types ) ) );
		$slug_urls = array_values( array_unique( array_map( 'get_permalink', array_map( 'intval', $same ) ) ) );

		foreach ( array( 'old_slug' => $old_urls, 'redirect' => $redirect_urls, 'slug' => $slug_urls ) as $source => $urls ) {
			foreach ( $urls as $url ) {
				$out['candidates'][] = array( 'url' => (string) $url, 'source' => $source );
			}
			if ( null === $out['resolved'] && 1 === count( $urls ) ) {
				$out['resolved'] = (string) $urls[0];
				$out['source']   = $source;
			}
			if ( count( $urls ) > 1 && null === $out['resolved'] ) {
				break; // ambiguous at a stronger level: a human decides
			}
		}
		return $out;
	}
}
