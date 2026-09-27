<?php
/**
 * Encrypts the shared secret at rest with a key derived from this site's WordPress salts.
 *
 * libsodium ships with PHP 7.2+, so this needs no third-party code. If the salts change, the
 * secret can't be decrypted any more and the site simply has to be paired again.
 *
 * @package MendwellConnector
 */

defined( 'ABSPATH' ) || exit;

final class Mendwell_Crypto {
	const PREFIX = 'mw1:';

	private static function key() {
		return sodium_crypto_generichash( 'mendwell-connector-secret|' . wp_salt( 'auth' ) . '|' . wp_salt( 'secure_auth' ), '', SODIUM_CRYPTO_SECRETBOX_KEYBYTES );
	}

	/**
	 * @param string $plaintext Secret to protect.
	 * @return string Versioned, base64 ciphertext.
	 */
	public static function encrypt( $plaintext ) {
		$nonce = random_bytes( SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
		return self::PREFIX . base64_encode( $nonce . sodium_crypto_secretbox( $plaintext, $nonce, self::key() ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
	}

	/**
	 * @param string $stored Value from encrypt().
	 * @return string|null Plaintext, or null if it can't be decrypted (tampered, or salts changed).
	 */
	public static function decrypt( $stored ) {
		if ( ! is_string( $stored ) || 0 !== strpos( $stored, self::PREFIX ) ) {
			return null;
		}
		$raw = base64_decode( substr( $stored, strlen( self::PREFIX ) ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		if ( false === $raw || strlen( $raw ) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ) {
			return null;
		}
		$nonce  = substr( $raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
		$cipher = substr( $raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
		$plain  = sodium_crypto_secretbox_open( $cipher, $nonce, self::key() );
		return false === $plain ? null : $plain;
	}
}
