<?php
/**
 * PROJECT_SPEC §8.5: uninstall cleanup.
 *
 * @package MendwellConnector
 */

class Test_Mendwell_Uninstall extends Mendwell_Test_Case {

	public function test_removes_secret_options_transients_log_and_own_meta() {
		global $wpdb;
		Mendwell_State::set_paused( true );
		set_transient( 'mendwell_nonce_abc', 1, 600 );
		set_transient( Mendwell_State::TRANSIENT_CHALLENGE, 'x', 600 );
		$post = self::factory()->post->create();
		update_post_meta( $post, '_mendwell_meta_description', 'd' );
		update_post_meta( $post, '_unrelated', 'keep' );
		Mendwell_Log::record( 'f', 'post', $post, 'x', 'a', 'b' );

		if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
			define( 'WP_UNINSTALL_PLUGIN', 'mendwell-connector/mendwell-connector.php' );
		}
		// The test framework rewrites DROP TABLE into DROP TEMPORARY TABLE (to keep tests isolated),
		// so capture the SQL uninstall.php actually issues before that rewrite.
		$queries = array();
		$capture = function ( $query ) use ( &$queries ) {
			$queries[] = $query;
			return $query;
		};
		add_filter( 'query', $capture, 1 );
		include dirname( __DIR__ ) . '/uninstall.php';
		remove_filter( 'query', $capture, 1 );
		wp_cache_flush();

		foreach ( Mendwell_State::all_options() as $option ) {
			$this->assertFalse( get_option( $option ), $option );
		}
		$this->assertFalse( get_transient( 'mendwell_nonce_abc' ) );
		$this->assertFalse( get_transient( Mendwell_State::TRANSIENT_CHALLENGE ) );
		$this->assertSame( '', get_post_meta( $post, '_mendwell_meta_description', true ) );
		$this->assertSame( 'keep', get_post_meta( $post, '_unrelated', true ) );
		$this->assertContains( 'DROP TABLE IF EXISTS `' . Mendwell_Log::table() . '`', $queries );
		Mendwell_Log::install(); // restore for the other tests
	}
}
