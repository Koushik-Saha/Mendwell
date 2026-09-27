<?php
/**
 * Shared test helpers.
 *
 * @package MendwellConnector
 */

abstract class Mendwell_Test_Case extends WP_UnitTestCase {
	const SECRET = '4f1c0b8e9d2a7e6c5b3a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c';

	/** @var WP_REST_Server */
	protected $server;

	public function set_up() {
		parent::set_up();
		Mendwell_Log::install();
		Mendwell_State::save_pairing( self::SECRET, 'site_test', 'http://app.test' );
		Mendwell_State::set_paused( false );
		add_filter( 'mendwell_allow_http', '__return_true' );
		$this->server = rest_get_server();
	}

	public function tear_down() {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'TRUNCATE TABLE %i', Mendwell_Log::table() ) ); // phpcs:ignore
		remove_all_filters( 'mendwell_seo_plugin' );
		remove_all_filters( 'mendwell_allow_http' );
		parent::tear_down();
	}

	/**
	 * Build a signed REST request the way the Mendwell worker sends it.
	 *
	 * @param array $overrides secret, timestamp, nonce, sign_route, sign_method, sign_body.
	 */
	protected function signed( $method, $route, $body = null, array $query = array(), array $overrides = array() ) {
		$request = new WP_REST_Request( $method, $route );
		$json    = null === $body ? '' : wp_json_encode( $body );
		if ( null !== $body ) {
			$request->set_header( 'content-type', 'application/json' );
			$request->set_body( $json );
		}
		if ( $query ) {
			$request->set_query_params( $query );
		}
		$timestamp = isset( $overrides['timestamp'] ) ? (string) $overrides['timestamp'] : (string) time();
		$nonce     = isset( $overrides['nonce'] ) ? $overrides['nonce'] : str_replace( '.', '', uniqid( 'n', true ) ) . wp_generate_password( 8, false );
		$path      = Mendwell_Signature::canonical_path( isset( $overrides['sign_route'] ) ? $overrides['sign_route'] : $route, $query );
		$signature = Mendwell_Signature::sign(
			isset( $overrides['secret'] ) ? $overrides['secret'] : self::SECRET,
			isset( $overrides['sign_method'] ) ? $overrides['sign_method'] : $method,
			$path,
			$timestamp,
			$nonce,
			array_key_exists( 'sign_body', $overrides ) ? $overrides['sign_body'] : $json
		);
		$request->set_header( 'x-mendwell-timestamp', $timestamp );
		$request->set_header( 'x-mendwell-nonce', $nonce );
		$request->set_header( 'x-mendwell-signature', $signature );
		return $request;
	}

	protected function dispatch( WP_REST_Request $request ) {
		return $this->server->dispatch( $request );
	}

	protected function image( $name = 'photo' ) {
		$id = self::factory()->attachment->create_upload_object( DIR_TESTDATA . '/images/canola.jpg' );
		wp_update_post( array( 'ID' => $id, 'post_title' => $name ) );
		return $id;
	}

	protected function log_rows( $fix_id ) {
		return Mendwell_Log::for_fix( $fix_id );
	}
}
