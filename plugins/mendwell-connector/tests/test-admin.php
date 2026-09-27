<?php
/**
 * Settings page: escaped output and capability checks (SECURITY.md §2 Connector).
 *
 * @package MendwellConnector
 */

class Test_Mendwell_Admin extends Mendwell_Test_Case {

	public function test_escapes_logged_values_and_ignores_unknown_notices() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$post = self::factory()->post->create( array( 'post_title' => '<img src=x onerror=alert(1)>' ) );
		Mendwell_Log::record( 'fix_x"><script>alert(2)</script>', 'post', $post, '_yoast_wpseo_title', '<script>alert(3)</script>', 'Safe' );
		$_GET['mendwell_notice'] = '<script>alert(4)</script>';
		ob_start();
		Mendwell_Admin::render();
		$html = ob_get_clean();
		unset( $_GET['mendwell_notice'] );
		$this->assertStringNotContainsString( '<script>', $html );
		$this->assertStringNotContainsString( '<img src=x onerror', $html );
		$this->assertStringContainsString( 'Recent changes', $html );
	}

	public function test_actions_require_manage_options() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$this->expectException( WPDieException::class );
		Mendwell_Admin::handle_toggle_pause();
	}

	public function test_actions_require_a_valid_nonce() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$_REQUEST['_wpnonce'] = 'wrong';
		$this->expectException( WPDieException::class );
		try {
			Mendwell_Admin::handle_disconnect();
		} finally {
			unset( $_REQUEST['_wpnonce'] );
			$this->assertTrue( Mendwell_State::is_paired(), 'nothing happened' );
		}
	}
}
