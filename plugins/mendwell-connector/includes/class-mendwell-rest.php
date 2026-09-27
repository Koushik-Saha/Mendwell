<?php
/**
 * REST API: /wp-json/mendwell/v1/… (PROJECT_SPEC §8.3). Every route except the unsigned status
 * challenge requires a valid signature (SECURITY.md T3).
 *
 * @package MendwellConnector
 */

defined( 'ABSPATH' ) || exit;

final class Mendwell_Rest {
	const NS = 'mendwell/v1';

	public static function signed( WP_REST_Request $request ) {
		return Mendwell_Signature::verify( $request );
	}

	private static function fix_id_arg() {
		return array(
			'type'              => 'string',
			'required'          => true,
			'validate_callback' => function ( $value ) {
				return is_string( $value ) && 1 === preg_match( '/^[A-Za-z0-9_-]{1,64}$/', $value );
			},
		);
	}

	private static function text_arg( $required = true ) {
		return array( 'type' => 'string', 'required' => $required, 'sanitize_callback' => 'sanitize_text_field' );
	}

	public static function register_routes() {
		register_rest_route( self::NS, '/status', array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'status' ), 'permission_callback' => '__return_true' ) );

		register_rest_route(
			self::NS,
			'/media/(?P<id>\d+)/usage',
			array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'media_usage' ), 'permission_callback' => array( __CLASS__, 'signed' ) )
		);
		register_rest_route(
			self::NS,
			'/resolve-path',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'resolve_path' ),
				'permission_callback' => array( __CLASS__, 'signed' ),
				'args'                => array( 'path' => array( 'type' => 'string', 'required' => true ) ),
			)
		);
		register_rest_route(
			self::NS,
			'/fix/alt',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'fix_alt' ),
				'permission_callback' => array( __CLASS__, 'signed' ),
				'args'                => array(
					'fixId'           => self::fix_id_arg(),
					'attachmentId'    => array( 'type' => 'integer', 'required' => true, 'minimum' => 1 ),
					'value'           => array( 'type' => 'string', 'required' => true ),
					'expectedCurrent' => array( 'type' => 'string', 'required' => true ),
				),
			)
		);
		register_rest_route(
			self::NS,
			'/fix/meta',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'fix_meta' ),
				'permission_callback' => array( __CLASS__, 'signed' ),
				'args'                => array(
					'fixId'           => self::fix_id_arg(),
					'postId'          => array( 'type' => 'integer', 'required' => true, 'minimum' => 1 ),
					'title'           => array( 'type' => 'string', 'required' => false ),
					'description'     => array( 'type' => 'string', 'required' => false ),
					'expectedCurrent' => array( 'type' => 'object', 'required' => true ),
				),
			)
		);
		register_rest_route(
			self::NS,
			'/fix/link',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'fix_link' ),
				'permission_callback' => array( __CLASS__, 'signed' ),
				'args'                => array(
					'fixId'   => self::fix_id_arg(),
					'postId'  => array( 'type' => 'integer', 'required' => true, 'minimum' => 1 ),
					'oldHref' => array( 'type' => 'string', 'required' => true ),
					'newHref' => array( 'type' => 'string', 'required' => true ),
				),
			)
		);
		register_rest_route(
			self::NS,
			'/undo/(?P<fixId>[A-Za-z0-9_-]{1,64})',
			array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'undo' ), 'permission_callback' => array( __CLASS__, 'signed' ) )
		);
		register_rest_route(
			self::NS,
			'/cache/purge',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'cache_purge' ),
				'permission_callback' => array( __CLASS__, 'signed' ),
				'args'                => array( 'urls' => array( 'type' => 'array', 'required' => true, 'items' => array( 'type' => 'string' ), 'maxItems' => 50 ) ),
			)
		);
		register_rest_route( self::NS, '/pause', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'pause' ), 'permission_callback' => array( __CLASS__, 'signed' ) ) );
		register_rest_route( self::NS, '/resume', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'resume' ), 'permission_callback' => array( __CLASS__, 'signed' ) ) );
	}

	/**
	 * Unsigned: only the plugin name and, during pairing, the challenge (PROJECT_SPEC §8.1 step 4).
	 * Signed: versions, SEO/cache plugins, WooCommerce pages, paused flag.
	 */
	public static function status( WP_REST_Request $request ) {
		$signed = $request->get_header( 'x_mendwell_signature' ) && true === Mendwell_Signature::verify( $request );
		if ( ! $signed ) {
			return rest_ensure_response( array( 'plugin' => 'mendwell-connector', 'challenge' => Mendwell_Pairing::pending_challenge() ) );
		}
		global $wp_version;
		$woo = array( 'active' => defined( 'WC_VERSION' ), 'version' => defined( 'WC_VERSION' ) ? WC_VERSION : null, 'pages' => array() );
		if ( $woo['active'] && function_exists( 'wc_get_page_id' ) ) {
			foreach ( array( 'cart', 'checkout', 'myaccount', 'shop' ) as $page ) {
				$id = (int) wc_get_page_id( $page );
				if ( $id > 0 ) {
					$woo['pages'][ $page ] = array( 'id' => $id, 'url' => (string) get_permalink( $id ) );
				}
			}
		}
		return rest_ensure_response(
			array(
				'plugin'       => 'mendwell-connector',
				'version'      => MENDWELL_CONNECTOR_VERSION,
				'wordpress'    => $wp_version,
				'php'          => PHP_VERSION,
				'siteUrl'      => home_url( '/' ),
				'paused'       => Mendwell_State::is_paused(),
				'seoPlugin'    => Mendwell_Seo::detect(),
				'cachePlugins' => Mendwell_Cache::detect(),
				'woocommerce'  => $woo,
				'time'         => time(),
			)
		);
	}

	public static function media_usage( WP_REST_Request $request ) {
		$id = (int) $request['id'];
		if ( 'attachment' !== get_post_type( $id ) ) {
			return new WP_Error( 'mendwell_not_found', 'That image was not found.', array( 'status' => 404 ) );
		}
		return rest_ensure_response( array( 'attachmentId' => $id, 'posts' => Mendwell_Resolver::media_usage( $id ) ) );
	}

	public static function resolve_path( WP_REST_Request $request ) {
		return rest_ensure_response( Mendwell_Resolver::resolve_path( (string) $request['path'] ) );
	}

	public static function fix_alt( WP_REST_Request $request ) {
		return rest_ensure_response( Mendwell_Writer::fix_alt( $request['fixId'], (int) $request['attachmentId'], (string) $request['value'], (string) $request['expectedCurrent'] ) );
	}

	public static function fix_meta( WP_REST_Request $request ) {
		$expected = (array) $request['expectedCurrent'];
		$clean    = array();
		foreach ( array( 'title', 'description' ) as $field ) {
			if ( isset( $expected[ $field ] ) && is_string( $expected[ $field ] ) ) {
				$clean[ $field ] = $expected[ $field ];
			}
		}
		return rest_ensure_response(
			Mendwell_Writer::fix_meta(
				$request['fixId'],
				(int) $request['postId'],
				isset( $request['title'] ) ? (string) $request['title'] : null,
				isset( $request['description'] ) ? (string) $request['description'] : null,
				$clean
			)
		);
	}

	public static function fix_link( WP_REST_Request $request ) {
		return rest_ensure_response( Mendwell_Writer::fix_link( $request['fixId'], (int) $request['postId'], (string) $request['oldHref'], (string) $request['newHref'] ) );
	}

	public static function undo( WP_REST_Request $request ) {
		return rest_ensure_response( Mendwell_Writer::undo( (string) $request['fixId'] ) );
	}

	public static function cache_purge( WP_REST_Request $request ) {
		return rest_ensure_response( Mendwell_Cache::purge( (array) $request['urls'] ) );
	}

	public static function pause() {
		Mendwell_State::set_paused( true );
		return rest_ensure_response( array( 'paused' => true ) );
	}

	public static function resume() {
		Mendwell_State::set_paused( false );
		return rest_ensure_response( array( 'paused' => false ) );
	}
}
