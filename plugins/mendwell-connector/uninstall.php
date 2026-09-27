<?php
/**
 * Removes everything the plugin stored: the secret and options, transients, the change log, and
 * our own SEO meta (only printed by this plugin, so useless once it's gone).
 *
 * @package MendwellConnector
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

global $wpdb;

foreach ( array( 'mendwell_secret', 'mendwell_site_id', 'mendwell_app_url', 'mendwell_paused', 'mendwell_paired_at', 'mendwell_db_version' ) as $mendwell_option ) {
	delete_option( $mendwell_option );
}

// Nonce cache, pairing challenge and admin notices.
// phpcs:ignore WordPress.DB.DirectDatabaseQuery
$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE option_name LIKE %s OR option_name LIKE %s', $wpdb->options, $wpdb->esc_like( '_transient_mendwell_' ) . '%', $wpdb->esc_like( '_transient_timeout_mendwell_' ) . '%' ) );

delete_post_meta_by_key( '_mendwell_meta_title' );
delete_post_meta_by_key( '_mendwell_meta_description' );

// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.DirectDatabaseQuery.SchemaChange
$wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $wpdb->prefix . 'mendwell_log' ) );
