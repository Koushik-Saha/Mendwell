<?php
/**
 * Pairing (PROJECT_SPEC §8.1): send the one-time code to Mendwell, which checks our public status
 * challenge on this exact site URL, then returns the shared secret once.
 *
 * @package MendwellConnector
 */

defined( 'ABSPATH' ) || exit;

final class Mendwell_Pairing {
	const CHALLENGE_TTL = 600;

	public static function app_url() {
		$url = (string) apply_filters( 'mendwell_app_url', MENDWELL_APP_URL );
		return untrailingslashit( esc_url_raw( $url, array( 'http', 'https' ) ) );
	}

	/** Pairing codes look like ABCD-EFGH-JKLM. Anything else never leaves the site. */
	public static function normalize_code( $code ) {
		$code = strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', (string) $code ) );
		if ( ! preg_match( '/^[A-Z0-9]{8,32}$/', $code ) ) {
			return null;
		}
		return implode( '-', str_split( $code, 4 ) );
	}

	/** The value an unsigned GET status echoes while pairing is in progress. */
	public static function pending_challenge() {
		$value = get_transient( Mendwell_State::TRANSIENT_CHALLENGE );
		return is_string( $value ) ? $value : null;
	}

	/** @return true|WP_Error */
	public static function pair( $raw_code ) {
		$code = self::normalize_code( $raw_code );
		if ( null === $code ) {
			return new WP_Error( 'mendwell_bad_code', __( 'That pairing code doesn\'t look right. Copy it again from Mendwell.', 'mendwell-connector' ) );
		}
		$app = self::app_url();
		if ( 0 !== strpos( $app, 'https://' ) && ! ( defined( 'MENDWELL_ALLOW_HTTP' ) && MENDWELL_ALLOW_HTTP ) ) {
			return new WP_Error( 'mendwell_insecure_app', __( 'The Mendwell app address must use HTTPS.', 'mendwell-connector' ) );
		}

		$challenge = bin2hex( random_bytes( 32 ) );
		set_transient( Mendwell_State::TRANSIENT_CHALLENGE, $challenge, self::CHALLENGE_TTL );

		global $wp_version;
		$response = wp_remote_post(
			$app . '/api/connector/pair',
			array(
				'timeout'     => 30,
				'redirection' => 0,
				'headers'     => array( 'content-type' => 'application/json', 'accept' => 'application/json' ),
				'body'        => wp_json_encode(
					array(
						'code'      => $code,
						'siteUrl'   => home_url( '/' ),
						'challenge' => $challenge,
						'versions'  => array(
							'wordpress'   => $wp_version,
							'php'         => PHP_VERSION,
							'plugin'      => MENDWELL_CONNECTOR_VERSION,
							'woocommerce' => defined( 'WC_VERSION' ) ? WC_VERSION : null,
						),
					)
				),
			)
		);
		if ( is_wp_error( $response ) ) {
			delete_transient( Mendwell_State::TRANSIENT_CHALLENGE );
			return new WP_Error( 'mendwell_unreachable', __( 'Couldn\'t reach Mendwell. Check that this site can make outgoing HTTPS requests, then try again.', 'mendwell-connector' ) );
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$body   = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( 200 !== $status || ! is_array( $body ) ) {
			delete_transient( Mendwell_State::TRANSIENT_CHALLENGE );
			$message = is_array( $body ) && isset( $body['error']['message'] ) ? sanitize_text_field( $body['error']['message'] ) : __( 'Mendwell didn\'t accept that pairing code. Codes expire after 15 minutes and work once.', 'mendwell-connector' );
			return new WP_Error( 'mendwell_pair_rejected', $message );
		}
		$secret  = isset( $body['secret'] ) ? (string) $body['secret'] : '';
		$site_id = isset( $body['siteId'] ) ? (string) $body['siteId'] : '';
		if ( ! preg_match( '/^[0-9a-f]{64}$/', $secret ) || '' === $site_id ) {
			delete_transient( Mendwell_State::TRANSIENT_CHALLENGE );
			return new WP_Error( 'mendwell_pair_invalid', __( 'Mendwell sent an unexpected reply. Try again, or contact support.', 'mendwell-connector' ) );
		}
		Mendwell_State::save_pairing( $secret, $site_id, $app );
		return true;
	}
}
