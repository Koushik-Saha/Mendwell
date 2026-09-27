<?php
/**
 * PROJECT_SPEC §8.5: fix/link.
 *
 * @package MendwellConnector
 */

class Test_Mendwell_Fix_Link extends Mendwell_Test_Case {

	private function fix( $post, $old, $new ) {
		return $this->dispatch( $this->signed( 'POST', '/mendwell/v1/fix/link', array( 'fixId' => 'fix_link_1', 'postId' => $post, 'oldHref' => $old, 'newHref' => $new ) ) );
	}

	public function test_replaces_every_matching_href_and_nothing_else() {
		$post = self::factory()->post->create( array( 'post_content' => '<p><a href="/old-page/">one</a> <a href="/old-page/">two</a> <a href="/old-page-2/">keep</a></p>' ) );
		$response = $this->fix( $post, '/old-page/', 'https://example.org/new-page/' );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 2, $response->get_data()['linksChanged'] );
		$this->assertSame( '<p><a href="https://example.org/new-page/">one</a> <a href="https://example.org/new-page/">two</a> <a href="/old-page-2/">keep</a></p>', get_post_field( 'post_content', $post ) );
		$this->assertCount( 1, $this->log_rows( 'fix_link_1' ) );
	}

	public function test_conflict_when_the_link_is_no_longer_there() {
		$post = self::factory()->post->create( array( 'post_content' => '<a href="/fixed-already/">x</a>' ) );
		$this->assertSame( 409, $this->fix( $post, '/old-page/', 'https://example.org/' )->get_status() );
	}

	public function test_rejects_non_http_targets() {
		$post = self::factory()->post->create( array( 'post_content' => '<a href="/old-page/">x</a>' ) );
		$this->assertSame( 422, $this->fix( $post, '/old-page/', 'javascript:alert(1)' )->get_status() );
		$this->assertStringContainsString( 'href="/old-page/"', get_post_field( 'post_content', $post ) );
	}
}
