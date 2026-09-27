<?php
/**
 * PHPUnit bootstrap for wp-env (WordPress test suite in the tests-cli container).
 *
 * @package MendwellConnector
 */

$_tests_dir = getenv( 'WP_TESTS_DIR' ) ?: '/wordpress-phpunit';
if ( ! file_exists( $_tests_dir . '/includes/functions.php' ) ) {
	fwrite( STDERR, "WordPress test suite not found in {$_tests_dir}. Run the tests through wp-env: pnpm --filter mendwell-connector test\n" );
	exit( 1 );
}
define( 'WP_TESTS_PHPUNIT_POLYFILLS_PATH', dirname( __DIR__ ) . '/vendor/yoast/phpunit-polyfills' );

require_once $_tests_dir . '/includes/functions.php';

tests_add_filter(
	'muplugins_loaded',
	function () {
		require dirname( __DIR__ ) . '/mendwell-connector.php';
	}
);

require $_tests_dir . '/includes/bootstrap.php';
require __DIR__ . '/helpers.php';
