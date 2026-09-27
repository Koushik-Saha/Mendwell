<?php
/**
 * PROJECT_SPEC §8.1 pairing, with the Mendwell app mocked through pre_http_request.
 *
 * @package MendwellConnector
 */

class Test_Mendwell_Pairing extends Mendwell_Test_Case {

	private $requests = array();

	public function set_up() {
		parent::set_up();
		Mendwell_State::disconnect();
		$this->requests = array();
	}

	public function tear_down() {
		remove_all_filters( 'pre_http_request' );
		parent::tear_down();
	}

	/** @param callable $reply function( array $body ): array{status:int,body:array} */
	private function app( $reply ) {
		add_filter(
			'pre_http_request',
			function ( $pre, $args, $url ) use ( $reply ) {
				$body             = json_decode( $args['body'], true );
				$this->requests[] = array( 'url' => $url, 'body' => $body );
				$out              = $reply( $body );
				return array( 'response' => array( 'code' => $out['status'], 'message' => '' ), 'body' => wp_json_encode( $out['body'] ), 'headers' => array(), 'cookies' => array() );
			},
			10,
			3
		);
	}

	public function test_pairs_and_stores_the_secret_encrypted() {
		$secret = str_repeat( 'ab', 32 );
		$this->app(
			function ( $body ) use ( $secret ) {
				// What the Mendwell server does: fetch our public status and compare the challenge.
				$status = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/mendwell/v1/status' ) )->get_data();
				$ok     = $status['challenge'] === $body['challenge'];
				return $ok ? array( 'status' => 200, 'body' => array( 'siteId' => 'site_42', 'secret' => $secret ) ) : array( 'status' => 403, 'body' => array() );
			}
		);
		$this->assertTrue( Mendwell_Pairing::pair( 'abcd efgh jklm' ) );
		$this->assertSame( 'ABCD-EFGH-JKLM', $this->requests[0]['body']['code'] );
		$this->assertSame( home_url( '/' ), $this->requests[0]['body']['siteUrl'] );
		$this->assertStringEndsWith( '/api/connector/pair', $this->requests[0]['url'] );
		$this->assertSame( $secret, Mendwell_State::secret() );
		$this->assertStringNotContainsString( $secret, get_option( Mendwell_State::OPT_SECRET ) );
		$this->assertSame( 'site_42', get_option( Mendwell_State::OPT_SITE_ID ) );
		$this->assertNull( Mendwell_Pairing::pending_challenge(), 'challenge cleared after pairing' );
	}

	public function test_shows_the_apps_error_message_as_plain_text() {
		$this->app(
			function () {
				return array( 'status' => 404, 'body' => array( 'error' => array( 'code' => 'not_found', 'message' => 'That code expired. <b>Get a new one</b>.' ) ) );
			}
		);
		$result = Mendwell_Pairing::pair( 'ABCD-EFGH-JKLM' );
		$this->assertWPError( $result );
		$this->assertSame( 'That code expired. Get a new one.', $result->get_error_message() );
		$this->assertFalse( Mendwell_State::is_paired() );
	}

	public function test_rejects_malformed_codes_without_calling_out() {
		$this->app(
			function () {
				return array( 'status' => 200, 'body' => array() );
			}
		);
		$this->assertWPError( Mendwell_Pairing::pair( 'short' ) );
		$this->assertWPError( Mendwell_Pairing::pair( '<script>' ) );
		$this->assertSame( array(), $this->requests );
	}

	public function test_rejects_a_reply_without_a_valid_256_bit_secret() {
		$this->app(
			function () {
				return array( 'status' => 200, 'body' => array( 'siteId' => 'x', 'secret' => 'too-short' ) );
			}
		);
		$this->assertSame( 'mendwell_pair_invalid', Mendwell_Pairing::pair( 'ABCD-EFGH-JKLM' )->get_error_code() );
		$this->assertFalse( Mendwell_State::is_paired() );
	}
}
