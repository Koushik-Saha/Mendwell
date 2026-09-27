<?php
/**
 * {prefix}mendwell_log: one row per field Mendwell changed, with the value before and after.
 * Undo, conflict detection and the admin screen all read from here.
 *
 * @package MendwellConnector
 */

defined( 'ABSPATH' ) || exit;

final class Mendwell_Log {
	const DB_VERSION     = '1';
	const OPT_DB_VERSION = 'mendwell_db_version';

	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'mendwell_log';
	}

	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table   = self::table();
		$charset = $wpdb->get_charset_collate();
		// Static DDL with no user input; dbDelta is WordPress's supported way to create tables.
		dbDelta(
			"CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			fix_id varchar(64) NOT NULL,
			object_type varchar(32) NOT NULL,
			object_id bigint(20) unsigned NOT NULL,
			field varchar(191) NOT NULL,
			before_value longtext NOT NULL,
			after_value longtext NOT NULL,
			applied_at datetime NOT NULL,
			undone_at datetime DEFAULT NULL,
			PRIMARY KEY  (id),
			KEY fix_id (fix_id),
			KEY applied_at (applied_at)
		) {$charset};"
		);
		update_option( self::OPT_DB_VERSION, self::DB_VERSION, false );
	}

	public static function maybe_upgrade() {
		if ( self::DB_VERSION !== get_option( self::OPT_DB_VERSION ) ) {
			self::install();
		}
	}

	/** @return int Log row id. */
	public static function record( $fix_id, $object_type, $object_id, $field, $before, $after ) {
		global $wpdb;
		$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			self::table(),
			array(
				'fix_id'       => $fix_id,
				'object_type'  => $object_type,
				'object_id'    => (int) $object_id,
				'field'        => $field,
				'before_value' => (string) $before,
				'after_value'  => (string) $after,
				'applied_at'   => current_time( 'mysql', true ),
			),
			array( '%s', '%s', '%d', '%s', '%s', '%s', '%s' )
		);
		return (int) $wpdb->insert_id;
	}

	/** Rows for a fix that haven't been undone, newest first. */
	public static function for_fix( $fix_id ) {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		return $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i WHERE fix_id = %s AND undone_at IS NULL ORDER BY id DESC', self::table(), $fix_id ) );
	}

	public static function recent( $limit = 20 ) {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		return $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i ORDER BY id DESC LIMIT %d', self::table(), (int) $limit ) );
	}

	/** @param int[] $ids */
	public static function mark_undone( array $ids ) {
		global $wpdb;
		$now = current_time( 'mysql', true );
		foreach ( $ids as $id ) {
			$wpdb->update( self::table(), array( 'undone_at' => $now ), array( 'id' => (int) $id ), array( '%s' ), array( '%d' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		}
	}
}
