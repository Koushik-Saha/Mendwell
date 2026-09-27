<?php
/**
 * PROJECT_SPEC §8.5: undo + conflict.
 *
 * @package MendwellConnector
 */

class Test_Mendwell_Undo extends Mendwell_Test_Case {

	private function apply_alt( $image, $fix_id ) {
		$src  = wp_get_attachment_url( $image );
		$post = self::factory()->post->create( array( 'post_content' => "<img src=\"{$src}\" class=\"wp-image-{$image}\" alt=\"\">" ) );
		$this->dispatch( $this->signed( 'POST', '/mendwell/v1/fix/alt', array( 'fixId' => $fix_id, 'attachmentId' => $image, 'value' => 'Applied alt', 'expectedCurrent' => '' ) ) );
		return $post;
	}

	private function undo( $fix_id ) {
		return $this->dispatch( $this->signed( 'POST', '/mendwell/v1/undo/' . $fix_id, array() ) );
	}

	public function test_restores_every_before_value_and_marks_the_log() {
		$image = $this->image();
		$post  = $this->apply_alt( $image, 'fix_u1' );
		$response = $this->undo( 'fix_u1' );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 2, $response->get_data()['restored'] );
		$this->assertSame( '', get_post_meta( $image, '_wp_attachment_image_alt', true ) );
		$this->assertStringContainsString( 'alt=""', get_post_field( 'post_content', $post ) );
		$this->assertCount( 0, $this->log_rows( 'fix_u1' ) );
		$this->assertSame( 404, $this->undo( 'fix_u1' )->get_status(), 'nothing left to undo' );
	}

	public function test_never_overwrites_a_human_edit_and_changes_nothing_on_conflict() {
		$image = $this->image();
		$post  = $this->apply_alt( $image, 'fix_u2' );
		update_post_meta( $image, '_wp_attachment_image_alt', 'The owner improved it' );

		$response = $this->undo( 'fix_u2' );
		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'mendwell_conflict', $response->as_error()->get_error_code() );
		$this->assertSame( 'The owner improved it', get_post_meta( $image, '_wp_attachment_image_alt', true ) );
		$this->assertStringContainsString( 'alt="Applied alt"', get_post_field( 'post_content', $post ), 'all-or-nothing: the post was not reverted either' );
		$this->assertCount( 2, $this->log_rows( 'fix_u2' ) );
	}

	public function test_mendwell_cannot_undo_while_paused_but_the_site_admin_can() {
		$image = $this->image();
		$this->apply_alt( $image, 'fix_u3' );
		Mendwell_State::set_paused( true );
		$this->assertSame( 423, $this->undo( 'fix_u3' )->get_status() );
		$this->assertIsArray( Mendwell_Writer::undo( 'fix_u3', false ) );
		$this->assertSame( '', get_post_meta( $image, '_wp_attachment_image_alt', true ) );
	}

	public function test_undoes_meta_and_link_fixes() {
		add_filter( 'mendwell_seo_plugin', function () {
			return 'rankmath';
		} );
		$post = self::factory()->post->create( array( 'post_content' => '<a href="/gone/">x</a>' ) );
		update_post_meta( $post, 'rank_math_title', wp_slash( 'Old \\ title' ) );
		$this->dispatch( $this->signed( 'POST', '/mendwell/v1/fix/meta', array( 'fixId' => 'fix_u4', 'postId' => $post, 'title' => 'New title', 'expectedCurrent' => array( 'title' => 'Old \\ title' ) ) ) );
		$this->dispatch( $this->signed( 'POST', '/mendwell/v1/fix/link', array( 'fixId' => 'fix_u5', 'postId' => $post, 'oldHref' => '/gone/', 'newHref' => 'https://example.org/here/' ) ) );
		$this->assertSame( 200, $this->undo( 'fix_u5' )->get_status() );
		$this->assertSame( 200, $this->undo( 'fix_u4' )->get_status() );
		$this->assertSame( 'Old \\ title', get_post_meta( $post, 'rank_math_title', true ), 'backslashes survive the round trip' );
		$this->assertSame( '<a href="/gone/">x</a>', get_post_field( 'post_content', $post ) );
	}
}
