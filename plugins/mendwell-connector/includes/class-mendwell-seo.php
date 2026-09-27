<?php
/**
 * Where meta titles and descriptions live: the active SEO plugin's fields, or (with no SEO plugin)
 * our own post meta, which we print in <head> ourselves. Only when no SEO plugin is active, so
 * a page never gets two descriptions.
 *
 * @package MendwellConnector
 */

defined( 'ABSPATH' ) || exit;

final class Mendwell_Seo {
	const OWN_TITLE = '_mendwell_meta_title';
	const OWN_DESC  = '_mendwell_meta_description';

	/** @return string yoast | rankmath | seopress | none | other (an SEO plugin we don't write to) */
	public static function detect() {
		$plugin = 'none';
		if ( defined( 'WPSEO_VERSION' ) ) {
			$plugin = 'yoast';
		} elseif ( defined( 'RANK_MATH_VERSION' ) ) {
			$plugin = 'rankmath';
		} elseif ( defined( 'SEOPRESS_VERSION' ) ) {
			$plugin = 'seopress';
		} elseif ( defined( 'AIOSEO_VERSION' ) || defined( 'THE_SEO_FRAMEWORK_VERSION' ) || defined( 'SQ_VERSION' ) ) {
			$plugin = 'other';
		}
		/** Lets tests (and unusual setups) state which SEO plugin is in charge. */
		return (string) apply_filters( 'mendwell_seo_plugin', $plugin );
	}

	/** @return array{title:string,description:string}|null Meta keys for the plugin, or null if we can't write safely. */
	public static function meta_keys( $plugin = null ) {
		$plugin = null === $plugin ? self::detect() : $plugin;
		switch ( $plugin ) {
			case 'yoast':
				return array( 'title' => '_yoast_wpseo_title', 'description' => '_yoast_wpseo_metadesc' );
			case 'rankmath':
				return array( 'title' => 'rank_math_title', 'description' => 'rank_math_description' );
			case 'seopress':
				return array( 'title' => '_seopress_titles_title', 'description' => '_seopress_titles_desc' );
			case 'none':
				return array( 'title' => self::OWN_TITLE, 'description' => self::OWN_DESC );
			default:
				return null;
		}
	}

	public static function register_output() {
		add_filter( 'pre_get_document_title', array( __CLASS__, 'filter_title' ), 20 );
		add_action( 'wp_head', array( __CLASS__, 'print_description' ), 1 );
	}

	private static function own_value( $key ) {
		if ( 'none' !== self::detect() || ! is_singular() ) {
			return '';
		}
		$value = get_post_meta( (int) get_queried_object_id(), $key, true );
		return is_string( $value ) ? trim( $value ) : '';
	}

	/** wp_get_document_title() prints this value as-is, so it must be escaped here. */
	public static function filter_title( $title ) {
		$own = self::own_value( self::OWN_TITLE );
		return '' === $own ? $title : esc_html( $own );
	}

	public static function print_description() {
		$own = self::own_value( self::OWN_DESC );
		if ( '' !== $own ) {
			echo '<meta name="description" content="' . esc_attr( $own ) . '" />' . "\n";
		}
	}
}
