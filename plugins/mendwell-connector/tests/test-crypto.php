<?php
/**
 * Secret storage (SECURITY.md T2): encrypted with the WP salts, autoload off.
 *
 * @package MendwellConnector
 */

class Test_Mendwell_Crypto extends Mendwell_Test_Case {

	public function test_round_trips_and_uses_a_fresh_nonce() {
		$a = Mendwell_Crypto::encrypt( self::SECRET );
		$b = Mendwell_Crypto::encrypt( self::SECRET );
		$this->assertNotSame( $a, $b );
		$this->assertSame( self::SECRET, Mendwell_Crypto::decrypt( $a ) );
	}

	public function test_stored_secret_is_encrypted_and_not_autoloaded() {
		global $wpdb;
		$stored = get_option( Mendwell_State::OPT_SECRET );
		$this->assertStringStartsWith( 'mw1:', $stored );
		$this->assertStringNotContainsString( self::SECRET, $stored );
		$autoload = $wpdb->get_var( $wpdb->prepare( 'SELECT autoload FROM %i WHERE option_name = %s', $wpdb->options, Mendwell_State::OPT_SECRET ) ); // phpcs:ignore
		$this->assertContains( $autoload, array( 'no', 'off' ) );
	}

	public function test_rejects_tampered_or_foreign_values() {
		$stored = Mendwell_Crypto::encrypt( self::SECRET );
		$raw    = base64_decode( substr( $stored, 4 ) ); // phpcs:ignore
		$raw[ strlen( $raw ) - 1 ] = chr( ord( $raw[ strlen( $raw ) - 1 ] ) ^ 1 );
		$this->assertNull( Mendwell_Crypto::decrypt( 'mw1:' . base64_encode( $raw ) ) ); // phpcs:ignore
		$this->assertNull( Mendwell_Crypto::decrypt( self::SECRET ) );
		$this->assertNull( Mendwell_Crypto::decrypt( 'mw1:not-base64!!' ) );
	}

	public function test_changing_the_salts_makes_the_secret_unreadable() {
		$stored = Mendwell_Crypto::encrypt( self::SECRET );
		add_filter( 'salt', function ( $salt ) {
			return $salt . 'rotated';
		} );
		$this->assertNull( Mendwell_Crypto::decrypt( $stored ) );
		remove_all_filters( 'salt' );
	}
}
