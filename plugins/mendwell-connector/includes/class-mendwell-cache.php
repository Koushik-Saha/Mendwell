<?php
/**
 * Best-effort cache purge after a fix, so verification sees the new HTML. Each integration is
 * isolated: one plugin failing never stops the others, and nothing here is required to succeed.
 *
 * @package MendwellConnector
 */

defined( 'ABSPATH' ) || exit;

final class Mendwell_Cache {
	/** Cache plugins present on this site (for status). */
	public static function detect() {
		$found = array();
		if ( function_exists( 'rocket_clean_files' ) ) {
			$found[] = 'wp-rocket';
		}
		if ( function_exists( 'w3tc_flush_url' ) ) {
			$found[] = 'w3-total-cache';
		}
		if ( defined( 'LSCWP_V' ) ) {
			$found[] = 'litespeed-cache';
		}
		if ( function_exists( 'wpsc_delete_url_cache' ) ) {
			$found[] = 'wp-super-cache';
		}
		if ( function_exists( 'sg_cachepress_purge_cache' ) ) {
			$found[] = 'siteground-optimizer';
		}
		if ( class_exists( 'Breeze_PurgeCache' ) || has_action( 'breeze_clear_all_cache' ) ) {
			$found[] = 'breeze';
		}
		return $found;
	}

	/**
	 * @param string[] $urls Same-site URLs only.
	 * @return array{purged:string[],failed:string[],skippedUrls:int}
	 */
	public static function purge( array $urls ) {
		$home  = wp_parse_url( home_url(), PHP_URL_HOST );
		$clean = array();
		foreach ( $urls as $url ) {
			$url = esc_url_raw( (string) $url, array( 'http', 'https' ) );
			if ( '' !== $url && wp_parse_url( $url, PHP_URL_HOST ) === $home ) {
				$clean[] = $url;
			}
		}
		$clean  = array_slice( array_values( array_unique( $clean ) ), 0, 50 );
		$result = array( 'purged' => array(), 'failed' => array(), 'skippedUrls' => count( $urls ) - count( $clean ) );

		$integrations = array(
			'wp-rocket'            => function ( $urls ) {
				rocket_clean_files( $urls );
			},
			'w3-total-cache'       => function ( $urls ) {
				foreach ( $urls as $url ) {
					w3tc_flush_url( $url );
				}
			},
			'litespeed-cache'      => function ( $urls ) {
				foreach ( $urls as $url ) {
					do_action( 'litespeed_purge_url', $url );
				}
			},
			'wp-super-cache'       => function ( $urls ) {
				foreach ( $urls as $url ) {
					wpsc_delete_url_cache( $url );
				}
			},
			'siteground-optimizer' => function ( $urls ) {
				foreach ( $urls as $url ) {
					sg_cachepress_purge_cache( $url );
				}
			},
			'breeze'               => function () {
				do_action( 'breeze_clear_all_cache' );
			},
		);
		foreach ( self::detect() as $name ) {
			try {
				$integrations[ $name ]( $clean );
				$result['purged'][] = $name;
			} catch ( Throwable $e ) {
				$result['failed'][] = $name;
			}
		}
		return $result;
	}
}
