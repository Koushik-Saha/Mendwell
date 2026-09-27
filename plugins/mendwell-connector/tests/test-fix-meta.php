<?php
/**
 * PROJECT_SPEC §8.5: Yoast / Rank Math / no-plugin meta paths.
 *
 * @package MendwellConnector
 */

class Test_Mendwell_Fix_Meta extends Mendwell_Test_Case {

	private function use_plugin( $plugin ) {
		add_filter( 'mendwell_seo_plugin', function () use ( $plugin ) {
			return $plugin;
		} );
	}

	private function fix( $post, array $fields, array $expected = array(), $fix_id = 'fix_meta_1' ) {
		return $this->dispatch( $this->signed( 'POST', '/mendwell/v1/fix/meta', array_merge( array( 'fixId' => $fix_id, 'postId' => $post, 'expectedCurrent' => (object) $expected ), $fields ) ) );
	}

	/** @dataProvider plugins */
	public function test_writes_to_the_active_seo_plugins_fields( $plugin, $title_key, $desc_key ) {
		$this->use_plugin( $plugin );
		$post     = self::factory()->post->create();
		$response = $this->fix( $post, array( 'title' => 'Hand-bound books in Portland', 'description' => 'We repair and hand-bind books, journals and family bibles in Portland, Oregon.' ) );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $plugin, $response->get_data()['seoPlugin'] );
		$this->assertSame( 'Hand-bound books in Portland', get_post_meta( $post, $title_key, true ) );
		$this->assertStringStartsWith( 'We repair', get_post_meta( $post, $desc_key, true ) );
		$this->assertCount( 2, $this->log_rows( 'fix_meta_1' ) );
	}

	public function plugins() {
		return array(
			'yoast'     => array( 'yoast', '_yoast_wpseo_title', '_yoast_wpseo_metadesc' ),
			'rank math' => array( 'rankmath', 'rank_math_title', 'rank_math_description' ),
			'seopress'  => array( 'seopress', '_seopress_titles_title', '_seopress_titles_desc' ),
			'none'      => array( 'none', '_mendwell_meta_title', '_mendwell_meta_description' ),
		);
	}

	public function test_without_an_seo_plugin_prints_its_own_title_and_description_escaped() {
		$this->use_plugin( 'none' );
		$post = self::factory()->post->create();
		$this->fix( $post, array( 'title' => 'Books & "bindery"', 'description' => 'Repairs <b>and</b> "rebinding"' ) );
		$this->go_to( get_permalink( $post ) );
		$this->assertSame( 'Books &amp; &quot;bindery&quot;', wp_get_document_title() );
		ob_start();
		Mendwell_Seo::print_description();
		$this->assertSame( '<meta name="description" content="Repairs and &quot;rebinding&quot;" />' . "\n", ob_get_clean() );
	}

	public function test_with_an_seo_plugin_prints_nothing_itself() {
		$post = self::factory()->post->create();
		update_post_meta( $post, '_mendwell_meta_description', 'Left over' );
		$this->use_plugin( 'yoast' );
		$this->go_to( get_permalink( $post ) );
		ob_start();
		Mendwell_Seo::print_description();
		$this->assertSame( '', ob_get_clean() );
	}

	public function test_refuses_seo_plugins_it_does_not_write_to() {
		$this->use_plugin( 'other' );
		$response = $this->fix( self::factory()->post->create(), array( 'title' => 'x y z' ) );
		$this->assertSame( 422, $response->get_status() );
		$this->assertSame( 'mendwell_unsupported_seo_plugin', $response->as_error()->get_error_code() );
	}

	public function test_refuses_when_a_field_changed_since_mendwell_looked() {
		$this->use_plugin( 'yoast' );
		$post = self::factory()->post->create();
		update_post_meta( $post, '_yoast_wpseo_metadesc', 'The owner wrote this' );
		$response = $this->fix( $post, array( 'description' => 'Ours' ), array( 'description' => '' ) );
		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'The owner wrote this', get_post_meta( $post, '_yoast_wpseo_metadesc', true ) );
	}

	public function test_only_published_posts() {
		$draft = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		$this->assertSame( 404, $this->fix( $draft, array( 'title' => 'x' ) )->get_status() );
	}
}
