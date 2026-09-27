<?php
/**
 * PROJECT_SPEC §8.5: signature validation and replay rejection.
 *
 * @package MendwellConnector
 */

class Test_Mendwell_Signature extends Mendwell_Test_Case {

	public function test_matches_the_shared_vectors_generated_independently() {
		$data = json_decode( file_get_contents( __DIR__ . '/vectors/signing.json' ), true ); // phpcs:ignore
		$this->assertNotEmpty( $data['vectors'] );
		foreach ( $data['vectors'] as $v ) {
			$path = Mendwell_Signature::canonical_path( $v['route'], $v['query'] );
			$this->assertSame( $v['path'], $path, $v['name'] );
			$this->assertSame( $v['canonical'], Mendwell_Signature::canonical_string( $v['method'], $path, $v['timestamp'], $v['nonce'], $v['body'] ), $v['name'] );
			$this->assertSame( $v['signature'], Mendwell_Signature::sign( $data['secret'], $v['method'], $path, $v['timestamp'], $v['nonce'], $v['body'] ), $v['name'] );
		}
	}

	public function test_accepts_a_correctly_signed_request() {
		$response = $this->dispatch( $this->signed( 'POST', '/mendwell/v1/pause', array() ) );
		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( Mendwell_State::is_paused() );
	}

	public function test_accepts_signed_get_with_query_parameters() {
		$response = $this->dispatch( $this->signed( 'GET', '/mendwell/v1/resolve-path', null, array( 'path' => '/nothing-here/' ) ) );
		$this->assertSame( 200, $response->get_status() );
	}

	/** @dataProvider tampering */
	public function test_rejects_tampering( $overrides ) {
		$response = $this->dispatch( $this->signed( 'POST', '/mendwell/v1/pause', array( 'a' => 1 ), array(), $overrides ) );
		$this->assertSame( 401, $response->get_status() );
		$this->assertSame( 'mendwell_bad_signature', $response->as_error()->get_error_code() );
		$this->assertFalse( Mendwell_State::is_paused() );
	}

	public function tampering() {
		return array(
			'wrong secret' => array( array( 'secret' => str_repeat( 'ab', 32 ) ) ),
			'other route'  => array( array( 'sign_route' => '/mendwell/v1/resume' ) ),
			'other method' => array( array( 'sign_method' => 'GET' ) ),
			'other body'   => array( array( 'sign_body' => '{"a":2}' ) ),
		);
	}

	public function test_enforces_the_300_second_window_both_ways() {
		foreach ( array( -301, 301 ) as $skew ) {
			$response = $this->dispatch( $this->signed( 'POST', '/mendwell/v1/pause', array(), array(), array( 'timestamp' => time() + $skew ) ) );
			$this->assertSame( 'mendwell_stale', $response->as_error()->get_error_code(), "skew {$skew}" );
		}
		$ok = $this->dispatch( $this->signed( 'POST', '/mendwell/v1/pause', array(), array(), array( 'timestamp' => time() - 299 ) ) );
		$this->assertSame( 200, $ok->get_status() );
	}

	public function test_rejects_a_replayed_nonce() {
		$first = $this->dispatch( $this->signed( 'POST', '/mendwell/v1/pause', array(), array(), array( 'nonce' => 'replay-nonce-1234567890' ) ) );
		$this->assertSame( 200, $first->get_status() );
		$again = $this->dispatch( $this->signed( 'POST', '/mendwell/v1/pause', array(), array(), array( 'nonce' => 'replay-nonce-1234567890' ) ) );
		$this->assertSame( 'mendwell_replay', $again->as_error()->get_error_code() );
	}

	public function test_a_bad_signature_does_not_burn_the_nonce() {
		$this->dispatch( $this->signed( 'POST', '/mendwell/v1/pause', array(), array(), array( 'nonce' => 'shared-nonce-abcdefghij', 'secret' => str_repeat( 'cd', 32 ) ) ) );
		$ok = $this->dispatch( $this->signed( 'POST', '/mendwell/v1/pause', array(), array(), array( 'nonce' => 'shared-nonce-abcdefghij' ) ) );
		$this->assertSame( 200, $ok->get_status() );
	}

	public function test_rejects_missing_or_malformed_headers() {
		$bare = new WP_REST_Request( 'POST', '/mendwell/v1/pause' );
		$this->assertSame( 401, $this->dispatch( $bare )->get_status() );

		$bad_nonce = $this->signed( 'POST', '/mendwell/v1/pause', array(), array(), array( 'nonce' => 'short' ) );
		$this->assertSame( 401, $this->dispatch( $bad_nonce )->get_status() );

		$bad_sig = $this->signed( 'POST', '/mendwell/v1/pause', array() );
		$bad_sig->set_header( 'x-mendwell-signature', 'not-hex' );
		$this->assertSame( 401, $this->dispatch( $bad_sig )->get_status() );
		$this->assertFalse( Mendwell_State::is_paused() );
	}

	public function test_rejects_everything_when_not_paired() {
		Mendwell_State::disconnect();
		$response = $this->dispatch( $this->signed( 'POST', '/mendwell/v1/pause', array() ) );
		$this->assertSame( 'mendwell_not_paired', $response->as_error()->get_error_code() );
	}

	public function test_requires_https_unless_allowed_for_local_development() {
		remove_all_filters( 'mendwell_allow_http' );
		add_filter( 'mendwell_allow_http', '__return_false' );
		$response = $this->dispatch( $this->signed( 'POST', '/mendwell/v1/pause', array() ) );
		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'mendwell_https_required', $response->as_error()->get_error_code() );
	}

	public function test_every_route_except_status_requires_a_signature() {
		$routes = $this->server->get_routes( 'mendwell/v1' );
		$this->assertGreaterThanOrEqual( 10, count( $routes ) );
		foreach ( $routes as $route => $handlers ) {
			foreach ( $handlers as $handler ) {
				// status: the unsigned pairing challenge (tested separately). The bare namespace route is
				// WordPress's auto-generated index of route names, added to every REST namespace.
				if ( '/mendwell/v1/status' === $route || '/mendwell/v1' === $route ) {
					continue;
				}
				$this->assertSame( array( 'Mendwell_Rest', 'signed' ), $handler['permission_callback'], $route );
			}
		}
	}
}
