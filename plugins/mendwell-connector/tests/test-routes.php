<?php
/**
 * Status, pause/resume, media usage, resolve-path and cache purge.
 *
 * @package MendwellConnector
 */

if ( ! function_exists( 'rocket_clean_files' ) ) {
	/** Stand-in for WP Rocket, recording what it was asked to purge. */
	function rocket_clean_files( $urls ) {
		$GLOBALS['mendwell_test_rocket'][] = $urls;
	}
}
if ( ! function_exists( 'w3tc_flush_url' ) ) {
	/** Stand-in for W3 Total Cache that fails, to prove one failure doesn't stop the rest. */
	function w3tc_flush_url( $url ) {
		throw new RuntimeException( 'w3tc broke' );
	}
}

class Test_Mendwell_Routes extends Mendwell_Test_Case {

	public function test_unsigned_status_reveals_only_the_pairing_challenge() {
		$data = $this->dispatch( new WP_REST_Request( 'GET', '/mendwell/v1/status' ) )->get_data();
		$this->assertSame( array( 'plugin' => 'mendwell-connector', 'challenge' => null ), $data );
		set_transient( Mendwell_State::TRANSIENT_CHALLENGE, 'abc123', 60 );
		$this->assertSame( 'abc123', $this->dispatch( new WP_REST_Request( 'GET', '/mendwell/v1/status' ) )->get_data()['challenge'] );
	}

	public function test_signed_status_reports_versions_plugins_and_pause() {
		Mendwell_State::set_paused( true );
		$data = $this->dispatch( $this->signed( 'GET', '/mendwell/v1/status' ) )->get_data();
		$this->assertSame( MENDWELL_CONNECTOR_VERSION, $data['version'] );
		$this->assertTrue( $data['paused'] );
		$this->assertSame( 'none', $data['seoPlugin'] );
		$this->assertContains( 'wp-rocket', $data['cachePlugins'] );
		$this->assertFalse( $data['woocommerce']['active'] );
		$this->assertArrayNotHasKey( 'challenge', $data );
	}

	public function test_pause_and_resume() {
		$this->assertTrue( $this->dispatch( $this->signed( 'POST', '/mendwell/v1/pause', array() ) )->get_data()['paused'] );
		$this->assertTrue( Mendwell_State::is_paused() );
		$this->assertFalse( $this->dispatch( $this->signed( 'POST', '/mendwell/v1/resume', array() ) )->get_data()['paused'] );
		$this->assertFalse( Mendwell_State::is_paused() );
	}

	public function test_media_usage_lists_published_posts_showing_the_image() {
		$image = $this->image();
		$post  = self::factory()->post->create( array( 'post_title' => 'Uses it', 'post_content' => '<img class="wp-image-' . $image . '" src="x.jpg">' ) );
		self::factory()->post->create( array( 'post_status' => 'draft', 'post_content' => '<img class="wp-image-' . $image . '" src="x.jpg">' ) );
		$data = $this->dispatch( $this->signed( 'GET', '/mendwell/v1/media/' . $image . '/usage' ) )->get_data();
		$this->assertSame( array( $post ), wp_list_pluck( $data['posts'], 'id' ) );
		$this->assertSame( 404, $this->dispatch( $this->signed( 'GET', '/mendwell/v1/media/' . $post . '/usage' ) )->get_status() );
	}

	private function resolve( $path ) {
		return $this->dispatch( $this->signed( 'GET', '/mendwell/v1/resolve-path', null, array( 'path' => $path ) ) )->get_data();
	}

	public function test_resolve_path_prefers_the_old_slug() {
		$post = self::factory()->post->create( array( 'post_name' => 'new-name' ) );
		add_post_meta( $post, '_wp_old_slug', 'old-name' );
		$result = $this->resolve( '/2024/01/old-name/' );
		$this->assertSame( get_permalink( $post ), $result['resolved'] );
		$this->assertSame( 'old_slug', $result['source'] );
	}

	public function test_resolve_path_uses_a_unique_slug_and_refuses_ambiguity() {
		$page = self::factory()->post->create( array( 'post_type' => 'page', 'post_name' => 'services' ) );
		$this->assertSame( get_permalink( $page ), $this->resolve( '/old-parent/services/' )['resolved'] );

		self::factory()->post->create( array( 'post_type' => 'page', 'post_name' => 'about' ) );
		self::factory()->post->create( array( 'post_type' => 'post', 'post_name' => 'about' ) );
		$ambiguous = $this->resolve( '/about/' );
		$this->assertNull( $ambiguous['resolved'] );
		$this->assertCount( 2, $ambiguous['candidates'] );

		$this->assertNull( $this->resolve( '/nothing-like-this/' )['resolved'] );
	}

	public function test_cache_purge_is_best_effort_and_same_site_only() {
		$GLOBALS['mendwell_test_rocket'] = array();
		$home   = home_url( '/page/' );
		$result = $this->dispatch( $this->signed( 'POST', '/mendwell/v1/cache/purge', array( 'urls' => array( $home, 'https://elsewhere.example/' ) ) ) )->get_data();
		$this->assertContains( 'wp-rocket', $result['purged'] );
		$this->assertContains( 'w3-total-cache', $result['failed'] );
		$this->assertSame( 1, $result['skippedUrls'] );
		$this->assertSame( array( array( $home ) ), $GLOBALS['mendwell_test_rocket'] );
	}
}
