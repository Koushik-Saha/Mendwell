<?php
/**
 * Settings → Mendwell (PROJECT_SPEC §8.4): pair, see status, pause everything, review and undo
 * the last 20 changes, disconnect. Every action is a nonce-checked admin-post form for users who
 * can manage options; every value printed is escaped.
 *
 * @package MendwellConnector
 */

defined( 'ABSPATH' ) || exit;

final class Mendwell_Admin {
	const SLUG = 'mendwell';

	/** Fixed messages keyed by code, so nothing from the query string is ever printed. */
	const NOTICES = array(
		'paired'       => array( 'success', 'Paired. Mendwell can now apply the fixes you approve.' ),
		'paused'       => array( 'success', 'All changes are paused. Mendwell will not change anything until you resume.' ),
		'resumed'      => array( 'success', 'Changes resumed.' ),
		'undone'       => array( 'success', 'Change undone.' ),
		'conflict'     => array( 'warning', 'Not undone: that content was edited after Mendwell changed it, so we left it alone.' ),
		'undo_failed'  => array( 'error', 'That change could not be undone.' ),
		'disconnected' => array( 'success', 'Disconnected. Mendwell can no longer make changes to this site.' ),
	);

	public static function register() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		foreach ( array( 'pair', 'toggle_pause', 'undo', 'disconnect' ) as $action ) {
			add_action( 'admin_post_mendwell_' . $action, array( __CLASS__, 'handle_' . $action ) );
		}
		add_filter( 'plugin_action_links_' . plugin_basename( MENDWELL_CONNECTOR_FILE ), array( __CLASS__, 'action_links' ) );
	}

	public static function menu() {
		add_options_page( 'Mendwell', 'Mendwell', 'manage_options', self::SLUG, array( __CLASS__, 'render' ) );
	}

	public static function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'options-general.php?page=' . self::SLUG ) ) . '">' . esc_html__( 'Settings', 'mendwell-connector' ) . '</a>' );
		return $links;
	}

	private static function guard( $action ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'mendwell-connector' ), 403 );
		}
		check_admin_referer( 'mendwell_' . $action );
	}

	private static function back( array $args ) {
		wp_safe_redirect( add_query_arg( $args, admin_url( 'options-general.php?page=' . self::SLUG ) ) );
		exit;
	}

	public static function handle_pair() {
		self::guard( 'pair' );
		$code   = isset( $_POST['pairing_code'] ) ? sanitize_text_field( wp_unslash( $_POST['pairing_code'] ) ) : '';
		$result = Mendwell_Pairing::pair( $code );
		if ( is_wp_error( $result ) ) {
			// The message is ours (or sanitized text from Mendwell); stored briefly for this user only.
			set_transient( 'mendwell_pair_error_' . get_current_user_id(), $result->get_error_message(), 60 );
			self::back( array( 'mendwell_notice' => 'pair_error' ) );
		}
		self::back( array( 'mendwell_notice' => 'paired' ) );
	}

	public static function handle_toggle_pause() {
		self::guard( 'toggle_pause' );
		$pause = ! Mendwell_State::is_paused();
		Mendwell_State::set_paused( $pause );
		self::back( array( 'mendwell_notice' => $pause ? 'paused' : 'resumed' ) );
	}

	public static function handle_undo() {
		self::guard( 'undo' );
		$fix_id = isset( $_POST['fix_id'] ) ? sanitize_text_field( wp_unslash( $_POST['fix_id'] ) ) : '';
		if ( ! preg_match( '/^[A-Za-z0-9_-]{1,64}$/', $fix_id ) ) {
			self::back( array( 'mendwell_notice' => 'undo_failed' ) );
		}
		$result = Mendwell_Writer::undo( $fix_id, false ); // a site admin may undo even while paused
		if ( is_wp_error( $result ) ) {
			self::back( array( 'mendwell_notice' => 'mendwell_conflict' === $result->get_error_code() ? 'conflict' : 'undo_failed' ) );
		}
		self::back( array( 'mendwell_notice' => 'undone' ) );
	}

	public static function handle_disconnect() {
		self::guard( 'disconnect' );
		Mendwell_State::disconnect();
		self::back( array( 'mendwell_notice' => 'disconnected' ) );
	}

	private static function form( $action, $label, $class = 'button', $fields = array() ) {
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="display:inline">';
		echo '<input type="hidden" name="action" value="' . esc_attr( 'mendwell_' . $action ) . '" />';
		foreach ( $fields as $name => $value ) {
			echo '<input type="hidden" name="' . esc_attr( $name ) . '" value="' . esc_attr( $value ) . '" />';
		}
		wp_nonce_field( 'mendwell_' . $action );
		echo '<button type="submit" class="' . esc_attr( $class ) . '">' . esc_html( $label ) . '</button></form>';
	}

	private static function describe( $row ) {
		switch ( $row->field ) {
			case Mendwell_Writer::ALT_KEY:
				return __( 'Image alt text', 'mendwell-connector' );
			case 'post_content':
				return __( 'Page content', 'mendwell-connector' );
			default:
				return false !== strpos( $row->field, 'desc' ) ? __( 'Meta description', 'mendwell-connector' ) : __( 'Meta title', 'mendwell-connector' );
		}
	}

	private static function excerpt( $value ) {
		$text = trim( wp_strip_all_tags( (string) $value ) );
		return '' === $text ? '(empty)' : wp_html_excerpt( $text, 80, '…' );
	}

	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$notice = isset( $_GET['mendwell_notice'] ) ? sanitize_key( wp_unslash( $_GET['mendwell_notice'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$paired = Mendwell_State::is_paired();
		$paused = Mendwell_State::is_paused();

		echo '<div class="wrap"><h1>' . esc_html__( 'Mendwell', 'mendwell-connector' ) . '</h1>';

		if ( 'pair_error' === $notice ) {
			$message = get_transient( 'mendwell_pair_error_' . get_current_user_id() );
			delete_transient( 'mendwell_pair_error_' . get_current_user_id() );
			echo '<div class="notice notice-error"><p>' . esc_html( is_string( $message ) ? $message : __( 'Pairing failed.', 'mendwell-connector' ) ) . '</p></div>';
		} elseif ( isset( self::NOTICES[ $notice ] ) ) {
			list( $type, $message ) = self::NOTICES[ $notice ];
			echo '<div class="notice notice-' . esc_attr( $type ) . '"><p>' . esc_html( $message ) . '</p></div>';
		}

		echo '<h2>' . esc_html__( 'Connection', 'mendwell-connector' ) . '</h2>';
		if ( $paired ) {
			echo '<p>' . esc_html__( 'Connected to', 'mendwell-connector' ) . ' <code>' . esc_html( (string) get_option( Mendwell_State::OPT_APP_URL ) ) . '</code> ';
			echo esc_html__( 'since', 'mendwell-connector' ) . ' ' . esc_html( (string) get_option( Mendwell_State::OPT_PAIRED ) ) . '.</p>';
		} else {
			echo '<p>' . esc_html__( 'Not connected. In Mendwell, choose Add site to get a pairing code, then paste it here. Codes work once and expire after 15 minutes.', 'mendwell-connector' ) . '</p>';
			echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
			echo '<input type="hidden" name="action" value="mendwell_pair" />';
			wp_nonce_field( 'mendwell_pair' );
			echo '<label for="mendwell-code">' . esc_html__( 'Pairing code', 'mendwell-connector' ) . '</label> ';
			echo '<input id="mendwell-code" name="pairing_code" type="text" class="regular-text code" autocomplete="off" spellcheck="false" required /> ';
			submit_button( __( 'Connect', 'mendwell-connector' ), 'primary', 'submit', false );
			echo '</form>';
		}

		echo '<h2>' . esc_html__( 'Pause all changes', 'mendwell-connector' ) . '</h2>';
		echo '<p>' . ( $paused
			? esc_html__( 'Paused: Mendwell will not change anything on this site.', 'mendwell-connector' )
			: esc_html__( 'Active: Mendwell can apply the fixes you approve. Pausing stops every change immediately; scans and reports continue.', 'mendwell-connector' ) ) . '</p>';
		self::form( 'toggle_pause', $paused ? __( 'Resume changes', 'mendwell-connector' ) : __( 'Pause all changes', 'mendwell-connector' ), $paused ? 'button button-primary' : 'button' );

		echo '<h2>' . esc_html__( 'Recent changes', 'mendwell-connector' ) . '</h2>';
		$rows = Mendwell_Log::recent( 20 );
		if ( empty( $rows ) ) {
			echo '<p>' . esc_html__( 'Mendwell hasn\'t changed anything yet.', 'mendwell-connector' ) . '</p>';
		} else {
			echo '<table class="widefat striped"><thead><tr>';
			foreach ( array( __( 'When (UTC)', 'mendwell-connector' ), __( 'What', 'mendwell-connector' ), __( 'Where', 'mendwell-connector' ), __( 'Before', 'mendwell-connector' ), __( 'After', 'mendwell-connector' ), '' ) as $heading ) {
				echo '<th scope="col">' . esc_html( $heading ) . '</th>';
			}
			echo '</tr></thead><tbody>';
			foreach ( $rows as $row ) {
				$link = get_edit_post_link( (int) $row->object_id, 'raw' );
				echo '<tr><td>' . esc_html( $row->applied_at ) . '</td><td>' . esc_html( self::describe( $row ) ) . '</td><td>';
				echo $link ? '<a href="' . esc_url( $link ) . '">' . esc_html( get_the_title( (int) $row->object_id ) ?: '#' . (int) $row->object_id ) . '</a>' : esc_html( '#' . (int) $row->object_id );
				echo '</td><td>' . esc_html( self::excerpt( $row->before_value ) ) . '</td><td>' . esc_html( self::excerpt( $row->after_value ) ) . '</td><td>';
				if ( null === $row->undone_at ) {
					self::form( 'undo', __( 'Undo', 'mendwell-connector' ), 'button button-small', array( 'fix_id' => $row->fix_id ) );
				} else {
					echo esc_html__( 'Undone', 'mendwell-connector' );
				}
				echo '</td></tr>';
			}
			echo '</tbody></table>';
		}

		if ( $paired ) {
			echo '<h2>' . esc_html__( 'Disconnect', 'mendwell-connector' ) . '</h2>';
			echo '<p>' . esc_html__( 'Deletes the shared secret. Mendwell can no longer change this site until you pair again. Changes already made stay, and you can still undo them above.', 'mendwell-connector' ) . '</p>';
			self::form( 'disconnect', __( 'Disconnect from Mendwell', 'mendwell-connector' ), 'button button-link-delete' );
		}

		echo '<p style="margin-top:2em">' . esc_html__( 'This plugin is open source:', 'mendwell-connector' ) . ' <a href="' . esc_url( 'https://github.com/Koushik-Saha/Mendwell/tree/main/plugins/mendwell-connector' ) . '">' . esc_html__( 'source code and changelog', 'mendwell-connector' ) . '</a>.</p>';
		echo '</div>';
	}
}
