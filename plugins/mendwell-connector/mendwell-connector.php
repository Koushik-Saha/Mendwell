<?php
/**
 * Plugin Name:       Mendwell Connector
 * Plugin URI:        https://github.com/Koushik-Saha/Mendwell
 * Description:       Lets Mendwell apply the fixes you approve (alt text, meta titles and descriptions, broken internal links), undo them, and pause at any time. Small, allowlisted, and logged.
 * Version:           0.1.0
 * Requires at least: 6.2
 * Requires PHP:      7.4
 * Author:            Mendwell
 * License:           GPL-2.0-or-later
 * Text Domain:       mendwell-connector
 *
 * @package MendwellConnector
 */

defined( 'ABSPATH' ) || exit;

define( 'MENDWELL_CONNECTOR_VERSION', '0.1.0' );
define( 'MENDWELL_CONNECTOR_FILE', __FILE__ );
define( 'MENDWELL_CONNECTOR_DIR', plugin_dir_path( __FILE__ ) );

// The Mendwell app this plugin pairs with. The release build sets it; wp-config.php can override it.
if ( ! defined( 'MENDWELL_APP_URL' ) ) {
	define( 'MENDWELL_APP_URL', 'http://localhost:3000' ); // @mendwell-build:app-url
}

require_once MENDWELL_CONNECTOR_DIR . 'includes/class-mendwell-crypto.php';
require_once MENDWELL_CONNECTOR_DIR . 'includes/class-mendwell-signature.php';
require_once MENDWELL_CONNECTOR_DIR . 'includes/class-mendwell-log.php';
require_once MENDWELL_CONNECTOR_DIR . 'includes/class-mendwell-state.php';
require_once MENDWELL_CONNECTOR_DIR . 'includes/class-mendwell-seo.php';
require_once MENDWELL_CONNECTOR_DIR . 'includes/class-mendwell-content.php';
require_once MENDWELL_CONNECTOR_DIR . 'includes/class-mendwell-writer.php';
require_once MENDWELL_CONNECTOR_DIR . 'includes/class-mendwell-resolver.php';
require_once MENDWELL_CONNECTOR_DIR . 'includes/class-mendwell-cache.php';
require_once MENDWELL_CONNECTOR_DIR . 'includes/class-mendwell-pairing.php';
require_once MENDWELL_CONNECTOR_DIR . 'includes/class-mendwell-rest.php';
require_once MENDWELL_CONNECTOR_DIR . 'includes/class-mendwell-admin.php';

register_activation_hook( __FILE__, array( 'Mendwell_Log', 'install' ) );
add_action( 'plugins_loaded', array( 'Mendwell_Log', 'maybe_upgrade' ) );
add_action( 'rest_api_init', array( 'Mendwell_Rest', 'register_routes' ) );
Mendwell_Seo::register_output();
if ( is_admin() ) {
	Mendwell_Admin::register();
}
