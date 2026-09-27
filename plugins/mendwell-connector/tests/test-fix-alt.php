<?php
/**
 * PROJECT_SPEC §8.5: fix/alt, Gutenberg block alt update, classic editor alt update, pause.
 *
 * @package MendwellConnector
 */

class Test_Mendwell_Fix_Alt extends Mendwell_Test_Case {

	private function block_post( $image_id, $status = 'publish' ) {
		$src = wp_get_attachment_url( $image_id );
		return self::factory()->post->create(
			array(
				'post_status'  => $status,
				'post_content' => "<!-- wp:image {\"id\":{$image_id}} -->\n<figure class=\"wp-block-image\"><img src=\"{$src}\" alt=\"\" class=\"wp-image-{$image_id}\"/></figure>\n<!-- /wp:image -->\n<!-- wp:paragraph --><p>Intro</p><!-- /wp:paragraph -->",
			)
		);
	}

	private function classic_post( $image_id ) {
		$src = wp_get_attachment_url( $image_id );
		return self::factory()->post->create(
			array( 'post_content' => "<p>Before</p><img class=\"alignnone size-medium wp-image-{$image_id}\" src=\"{$src}\" width=\"300\" height=\"200\" /><iframe src=\"https://www.youtube.com/embed/x\"></iframe>" )
		);
	}

	private function fix( $image_id, $value, $expected = '', $fix_id = 'fix_alt_1' ) {
		return $this->dispatch( $this->signed( 'POST', '/mendwell/v1/fix/alt', array( 'fixId' => $fix_id, 'attachmentId' => $image_id, 'value' => $value, 'expectedCurrent' => $expected ) ) );
	}

	public function test_sets_media_alt_and_updates_block_and_classic_images_in_published_posts() {
		$image   = $this->image();
		$other   = $this->image( 'other' );
		$block   = $this->block_post( $image );
		$classic = $this->classic_post( $image );
		$draft   = $this->block_post( $image, 'draft' );
		$unrelated = $this->block_post( $other );

		$response = $this->fix( $image, 'Yellow canola field under a blue sky' );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 2, $response->get_data()['postsUpdated'] );

		$this->assertSame( 'Yellow canola field under a blue sky', get_post_meta( $image, '_wp_attachment_image_alt', true ) );
		$this->assertStringContainsString( 'alt="Yellow canola field under a blue sky" class="wp-image-' . $image . '"', get_post_field( 'post_content', $block ) );
		$this->assertStringContainsString( '<!-- wp:image {"id":' . $image . '} -->', get_post_field( 'post_content', $block ), 'block comment left intact' );
		$this->assertStringContainsString( 'alt="Yellow canola field under a blue sky"', get_post_field( 'post_content', $classic ) );
		$this->assertStringNotContainsString( 'Yellow canola', get_post_field( 'post_content', $draft ), 'drafts are not touched' );
		$this->assertStringNotContainsString( 'Yellow canola', get_post_field( 'post_content', $unrelated ), 'other images are not touched' );

		$rows = $this->log_rows( 'fix_alt_1' );
		$this->assertCount( 3, $rows );
		$this->assertCount( 1, wp_get_post_revisions( $block ), 'WordPress kept a revision' );
	}

	public function test_does_not_strip_other_markup_when_saving() {
		$image = $this->image();
		// The owner (an admin with unfiltered_html) embedded a video. Create it as they would.
		kses_remove_filters();
		$classic = $this->classic_post( $image );
		kses_init_filters();
		$iframe = '<iframe src="https://www.youtube.com/embed/x"></iframe>';
		$this->assertStringContainsString( $iframe, get_post_field( 'post_content', $classic ), 'precondition: the embed exists' );

		wp_set_current_user( 0 ); // Mendwell's signed requests arrive without a logged-in user
		$kses_before = has_filter( 'content_save_pre', 'wp_filter_post_kses' );
		$this->assertNotFalse( $kses_before, 'precondition: kses is active for this request' );
		$this->fix( $image, 'A field' );
		$content = get_post_field( 'post_content', $classic );
		$this->assertStringContainsString( 'alt="A field"', $content );
		$this->assertStringContainsString( $iframe, $content, 'the embed survived our save' );
		$this->assertSame( $kses_before, has_filter( 'content_save_pre', 'wp_filter_post_kses' ), 'kses filter restored afterwards' );
	}

	public function test_matches_image_ids_exactly() {
		$image = $this->image();
		$post  = self::factory()->post->create( array( 'post_content' => '<img class="wp-image-' . $image . '0" src="https://elsewhere.test/x.png">' ) );
		$this->fix( $image, 'A field' );
		$this->assertStringNotContainsString( 'A field', get_post_field( 'post_content', $post ) );
	}

	public function test_refuses_when_the_current_value_is_not_what_mendwell_expected() {
		$image = $this->image();
		update_post_meta( $image, '_wp_attachment_image_alt', 'Written by the owner' );
		$response = $this->fix( $image, 'Our suggestion', '' );
		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'Written by the owner', $response->as_error()->get_error_data()['fields']['alt'] );
		$this->assertSame( 'Written by the owner', get_post_meta( $image, '_wp_attachment_image_alt', true ) );
		$this->assertCount( 0, $this->log_rows( 'fix_alt_1' ) );
	}

	public function test_refuses_everything_while_paused() {
		$image = $this->image();
		Mendwell_State::set_paused( true );
		$response = $this->fix( $image, 'Anything' );
		$this->assertSame( 423, $response->get_status() );
		$this->assertSame( '', get_post_meta( $image, '_wp_attachment_image_alt', true ) );
	}

	public function test_stores_plain_text_only() {
		$image = $this->image();
		$this->fix( $image, "<script>alert(1)</script>Field \n at <b>dusk</b>" );
		$this->assertSame( 'Field at dusk', get_post_meta( $image, '_wp_attachment_image_alt', true ) );
	}

	public function test_rejects_non_images_and_overlong_values() {
		$post = self::factory()->post->create();
		$this->assertSame( 404, $this->fix( $post, 'x' )->get_status() );
		$this->assertSame( 422, $this->fix( $this->image(), str_repeat( 'a', 301 ) )->get_status() );
	}
}
