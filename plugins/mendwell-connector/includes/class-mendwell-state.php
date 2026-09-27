<?php
/**
 * Pairing state, pause flag and settings. Every option is stored with autoload off.
 *
 * @package MendwellConnector
 */

defined( 'ABSPATH' ) || exit;

final class Mendwell_State {
	const OPT_SECRET  = 'mendwell_secret';
	const OPT_SITE_ID = 'mendwell_site_id';
	const OPT_APP_URL = 'mendwell_app_url';
	const OPT_PAUSED  = 'mendwell_paused';
	const OPT_PAIRED  = 'mendwell_paired_at';
	const TRANSIENT_CHALLENGE = 'mendwell_pair_challenge';

	public static function all_options() {
		return array( self::OPT_SECRET, self::OPT_SITE_ID, self::OPT_APP_URL, self::OPT_PAUSED, self::OPT_PAIRED, Mendwell_Log::OPT_DB_VERSION );
	}

	/** @return string|null The shared secret, decrypted in memory only. */
	public static function secret() {
		$stored = get_option( self::OPT_SECRET, '' );
		return '' === $stored ? null : Mendwell_Crypto::decrypt( $stored );
	}

	public static function is_paired() {
		return null !== self::secret();
	}

	public static function save_pairing( $secret, $site_id, $app_url ) {
		update_option( self::OPT_SECRET, Mendwell_Crypto::encrypt( $secret ), false );
		update_option( self::OPT_SITE_ID, sanitize_text_field( $site_id ), false );
		update_option( self::OPT_APP_URL, esc_url_raw( $app_url ), false );
		update_option( self::OPT_PAIRED, gmdate( 'c' ), false );
		delete_transient( self::TRANSIENT_CHALLENGE );
	}

	public static function disconnect() {
		foreach ( array( self::OPT_SECRET, self::OPT_SITE_ID, self::OPT_APP_URL, self::OPT_PAIRED ) as $option ) {
			delete_option( $option );
		}
	}

	public static function is_paused() {
		return '1' === get_option( self::OPT_PAUSED, '0' );
	}

	public static function set_paused( $paused ) {
		update_option( self::OPT_PAUSED, $paused ? '1' : '0', false );
	}
}
