<?php
/**
 * Request signing (PROJECT_SPEC §8.2, SECURITY.md T3). Must match packages/core connectorClient
 * exactly; tests/vectors/signing.json is shared by both test suites.
 *
 *   canonical = METHOD "\n" PATH "\n" TIMESTAMP "\n" NONCE "\n" hex(sha256(BODY))
 *   signature = hex(hmac_sha256(secret, canonical))
 *
 * PATH is the REST route ("/mendwell/v1/fix/alt"), independent of subfolder installs and
 * permalink settings, plus "?" and the query parameters sorted by name (RFC 3986 encoding)
 * when there are any.
 *
 * @package MendwellConnector
 */

defined( 'ABSPATH' ) || exit;

final class Mendwell_Signature {
	const MAX_SKEW    = 300; // seconds
	const NONCE_TTL   = 600; // 10 minutes
	const NONCE_REGEX = '/^[A-Za-z0-9_-]{16,64}$/';

	/**
	 * @param array<string,mixed> $query Query parameters.
	 */
	public static function canonical_path( $route, array $query ) {
		if ( empty( $query ) ) {
			return $route;
		}
		ksort( $query, SORT_STRING );
		$pairs = array();
		foreach ( $query as $key => $value ) {
			$pairs[] = rawurlencode( (string) $key ) . '=' . rawurlencode( is_scalar( $value ) ? (string) $value : '' );
		}
		return $route . '?' . implode( '&', $pairs );
	}

	public static function canonical_string( $method, $path, $timestamp, $nonce, $body ) {
		return strtoupper( $method ) . "\n" . $path . "\n" . $timestamp . "\n" . $nonce . "\n" . hash( 'sha256', (string) $body );
	}

	public static function sign( $secret, $method, $path, $timestamp, $nonce, $body ) {
		return hash_hmac( 'sha256', self::canonical_string( $method, $path, $timestamp, $nonce, $body ), $secret );
	}

	/**
	 * Verify a request. Order matters: cheap format checks, then the signature (constant time),
	 * and only then record the nonce, so unsigned junk can't fill the nonce cache.
	 *
	 * @return true|WP_Error
	 */
	public static function verify( WP_REST_Request $request, $now = null ) {
		$now    = null === $now ? time() : (int) $now;
		$secret = Mendwell_State::secret();
		if ( null === $secret ) {
			return new WP_Error( 'mendwell_not_paired', 'This site is not paired with Mendwell.', array( 'status' => 401 ) );
		}
		if ( ! self::transport_ok() ) {
			return new WP_Error( 'mendwell_https_required', 'Mendwell requests must use HTTPS.', array( 'status' => 403 ) );
		}

		$timestamp = (string) $request->get_header( 'x_mendwell_timestamp' );
		$nonce     = (string) $request->get_header( 'x_mendwell_nonce' );
		$signature = strtolower( (string) $request->get_header( 'x_mendwell_signature' ) );
		if ( ! ctype_digit( $timestamp ) || ! preg_match( self::NONCE_REGEX, $nonce ) || ! preg_match( '/^[0-9a-f]{64}$/', $signature ) ) {
			return self::unauthorized();
		}
		if ( abs( $now - (int) $timestamp ) > self::MAX_SKEW ) {
			return new WP_Error( 'mendwell_stale', 'Request timestamp is outside the allowed window.', array( 'status' => 401 ) );
		}

		$path     = self::canonical_path( $request->get_route(), $request->get_query_params() );
		$expected = self::sign( $secret, $request->get_method(), $path, $timestamp, $nonce, $request->get_body() );
		if ( ! hash_equals( $expected, $signature ) ) {
			return self::unauthorized();
		}

		$key = 'mendwell_nonce_' . substr( hash( 'sha256', $nonce ), 0, 40 );
		if ( false !== get_transient( $key ) ) {
			return new WP_Error( 'mendwell_replay', 'This request was already used.', array( 'status' => 401 ) );
		}
		set_transient( $key, 1, self::NONCE_TTL );
		return true;
	}

	/** HTTPS only (T3). Local development can opt out with MENDWELL_ALLOW_HTTP in wp-config.php. */
	private static function transport_ok() {
		$allow_http = defined( 'MENDWELL_ALLOW_HTTP' ) && MENDWELL_ALLOW_HTTP;
		return is_ssl() || (bool) apply_filters( 'mendwell_allow_http', $allow_http );
	}

	private static function unauthorized() {
		// One message for every signature problem: don't tell an attacker which part was wrong.
		return new WP_Error( 'mendwell_bad_signature', 'Request signature is not valid.', array( 'status' => 401 ) );
	}
}
