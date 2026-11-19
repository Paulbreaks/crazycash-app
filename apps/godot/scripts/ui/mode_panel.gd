class_name ModePanel
extends Control

## MODE-панель отвечает только за интерфейс. Все деньги, proof и операции TON
## остаются на стороне Shell и API; Godot лишь передаёт намерения игрока.
signal close_pressed
signal mode_view_toggled(is_ton_view: bool)
signal fun_credits_requested
signal ton_connect_requested
signal ton_disconnect_requested
signal ton_top_up_requested(amount: String)
signal ton_withdraw_requested(amount: String)
# Звук успешного вывода принадлежит игровому контроллеру Slots, поэтому UI
# сообщает о событии сигналом, а не ищет AudioStreamPlayer по дереву сцены.
# Для депозита звук не воспроизводится: iOS может поставить Web Audio на паузу
# при возврате из Tonkeeper и проиграть его лишь при следующем случайном тапе.
signal ton_withdrawal_confirmed
signal ton_connect_alert_opened
## Нажатия вкладок не меняют сетевое состояние, но всё равно должны давать
## тот же click.wav, что и остальные элементы интерфейса.
signal ton_ui_clicked
signal denomination_selected(index: int, api_value: String)
signal panel_open_state_changed(is_open: bool)

@export_range(0.05, 2.0, 0.01, "suffix:s") var slide_duration := 0.32
@export var fun_credit_pressed_offset := Vector2(0, 4)
@export var ton_pressed_offset := Vector2(0, 4)
@export var connect_pressed_offset := Vector2(0, 4)
@export_range(0.2, 5.0, 0.1, "suffix:s") var status_banner_duration := 2.0
# Это предел только для визуального ожидания. Он не отменяет on-chain intent:
# после возврата формы Shell всё ещё может прислать поздний подтверждённый итог.
@export_range(10.0, 120.0, 1.0, "suffix:s") var deposit_spinner_timeout := 60.0

@onready var backdrop: ColorRect = $Backdrop
@onready var page: Control = $Page
@onready var background: TextureRect = $Page/Background
@onready var close_button: TextureButton = $Page/Header/CloseButton
@onready var profile_icon: TextureRect = $Page/Header/Balance/ProfileIcon
@onready var balance_title: Label = $Page/Header/Balance/BalanceTitle
@onready var currency_icon: TextureRect = $Page/Header/Balance/CurrencyIcon
@onready var balance_value: Label = $Page/Header/Balance/BalanceValue
@onready var fun_label: Label = $Page/Header/ModeSwitch/FunLabel
@onready var ton_label: Label = $Page/Header/ModeSwitch/TonLabel
@onready var track: TextureRect = $Page/Header/ModeSwitch/Switch/Track
@onready var toggle: TextureRect = $Page/Header/ModeSwitch/Switch/Toggle
@onready var toggle_hit_area: TextureButton = $Page/Header/ModeSwitch/Switch/HitArea
@onready var fun_content: Control = $Page/FunContent
@onready var ton_content: Control = $Page/TonContent
@onready var add_credits_button: TextureButton = $Page/FunContent/AddCreditsButton

@onready var topup_tab_button: TextureButton = $Page/TonContent/MenuButtons/TopupButton
@onready var withdraw_tab_button: TextureButton = $Page/TonContent/MenuButtons/WithdrawButton
@onready var denom_tab_button: TextureButton = $Page/TonContent/MenuButtons/DenomButton
@onready var wallet_connect_button: Control = $Page/TonContent/WalletConnectButton
@onready var wallet_connect_panel: Panel = $Page/TonContent/WalletConnectButton/Panel
@onready var wallet_connect_label: Label = $Page/TonContent/WalletConnectButton/ButtonValue
@onready var topup_box: Control = $Page/TonContent/TopupBox
@onready var withdraw_box: Control = $Page/TonContent/WithdrawBox
@onready var denom_box: Control = $Page/TonContent/DenomBox
@onready var wallet_balance_value: Label = $Page/TonContent/TopupBox/WalletBalance/BalanceValue
@onready var topup_input_container: Control = $Page/TonContent/TopupBox/TopupInput
@onready var topup_input: LineEdit = $Page/TonContent/TopupBox/TopupInput/LineEdit
@onready var topup_submit_button: TextureButton = $Page/TonContent/TopupBox/TopupInput/SubmitButton
@onready var topup_amount_buttons: Array[Button] = [
	$Page/TonContent/TopupBox/TopupInput/AmountButtons/Amount01Button,
	$Page/TonContent/TopupBox/TopupInput/AmountButtons/Amount05Button,
	$Page/TonContent/TopupBox/TopupInput/AmountButtons/Amount1Button,
	$Page/TonContent/TopupBox/TopupInput/AmountButtons/Amount2Button,
	$Page/TonContent/TopupBox/TopupInput/AmountButtons/Amount5Button,
	$Page/TonContent/TopupBox/TopupInput/AmountButtons/Amount10Button,
	$Page/TonContent/TopupBox/TopupInput/AmountButtons/Amount50Button,
	$Page/TonContent/TopupBox/TopupInput/AmountButtons/Amount100Button,
]
@onready var deposit_spinner: Control = $Page/TonContent/TopupBox/DepositSpinner
@onready var deposit_spinner_image: TextureRect = $Page/TonContent/TopupBox/DepositSpinner/Spinner
@onready var deposit_spinner_text: Label = $Page/TonContent/TopupBox/DepositSpinner/AnimText
@onready var withdraw_input_container: Control = $Page/TonContent/WithdrawBox/InputBox
@onready var available_withdraw_value: Label = $Page/TonContent/WithdrawBox/InputBox/AvailableWithdraw/AvailableValue
@onready var withdraw_all_amount_button: Button = $Page/TonContent/WithdrawBox/InputBox/AllAmountButton
@onready var withdraw_input: LineEdit = $Page/TonContent/WithdrawBox/InputBox/LineEdit
@onready var withdraw_submit_button: TextureButton = $Page/TonContent/WithdrawBox/InputBox/SubmitButton
@onready var withdraw_spinner: Control = $Page/TonContent/WithdrawBox/WithdrawSpinner
@onready var withdraw_spinner_image: TextureRect = $Page/TonContent/WithdrawBox/WithdrawSpinner/Spinner
@onready var withdraw_spinner_text: Label = $Page/TonContent/WithdrawBox/WithdrawSpinner/AnimText
@onready var denomination_value: Label = $Page/TonContent/DenomBox/CurrentValue
@onready var denomination_001: TextureButton = $Page/TonContent/DenomBox/DenomButtons/Denomination001
@onready var denomination_01: TextureButton = $Page/TonContent/DenomBox/DenomButtons/Denomination01
@onready var denomination_1: TextureButton = $Page/TonContent/DenomBox/DenomButtons/Denomination1
@onready var denomination_10: TextureButton = $Page/TonContent/DenomBox/DenomButtons/Denomination10
@onready var ton_status_banner: Control = $Page/TonContent/StatusBanner
@onready var ton_success_banner: Panel = $Page/TonContent/StatusBanner/SuccessBanner
@onready var ton_error_banner: Panel = $Page/TonContent/StatusBanner/ErrorBanner
@onready var ton_status_text: Label = $Page/TonContent/StatusBanner/StatusText

@onready var fun_status_banner: Control = $Page/FunContent/StatusBanner
@onready var fun_success_banner: Panel = $Page/FunContent/StatusBanner/SuccessBanner
@onready var fun_error_banner: Panel = $Page/FunContent/StatusBanner/ErrorBanner
@onready var fun_success_text: Label = $Page/FunContent/StatusBanner/SuccessText
@onready var fun_error_text: Label = $Page/FunContent/StatusBanner/ErrorText
@onready var alert: Control = $Alert
@onready var alert_backdrop: ColorRect = $Alert/Backdrop
@onready var alert_close_button: TextureButton = $Alert/ConnectModal/CloseButton
@onready var alert_connect_button: TextureButton = $Alert/ConnectModal/TextureButton

const DEFAULT_PROFILE_ICON := preload("res://assets/other/user_ava_default.webp")
const FUN_ICON := preload("res://assets/other/coin_fun_icon.png")
const TON_ICON := preload("res://assets/other/coin_ton_icon.png")
const MAX_PROFILE_AVATAR_BYTES := 1_000_000
const MAX_PROFILE_AVATAR_BASE64_LENGTH := 1_400_000
const ACTIVE_LABEL_COLOR := Color.WHITE
const INACTIVE_LABEL_COLOR := Color(1.0, 1.0, 1.0, 0.5372549)
const TOGGLE_FUN_POSITION := Vector2(11.0, 10.0)
const TOGGLE_TON_POSITION := Vector2(57.0, 10.0)

# В БД 10 внутренних единиц = 0.01 TON; то есть 1000 = 1 TON.
const REAL_BALANCE_MIN_UNIT := 10
const REAL_BALANCE_UNITS_PER_TON := 1000
const MINIMUM_BET_CREDITS := 10
const MINIMUM_TOP_UP_UNITS := 100 # 0.10 TON
const MINIMUM_WITHDRAW_UNITS := 100 # 0.10 TON
const DENOMINATION_CREDIT_DIVISORS := [1, 10, 100, 1000]
const DENOMINATION_API_VALUES := ["0.01", "0.1", "1", "10"]
const LOADING_FRAMES := ["-  ", " - ", "  -"]
const DEPOSIT_PROCESSING_FRAMES := ["PAYMENT PROCESSING .", "PAYMENT PROCESSING ..", "PAYMENT PROCESSING ..."]
const WITHDRAW_PROCESSING_FRAMES := ["WITHDRAWAL PROCESSING .", "WITHDRAWAL PROCESSING ..", "WITHDRAWAL PROCESSING ..."]
const TON_TAB_TOP_UP := 0
const TON_TAB_WITHDRAW := 1
const TON_TAB_DENOM := 2

var _slide_tween: Tween
var _toggle_tween: Tween
var _fun_status_tween: Tween
var _ton_status_tween: Tween
var _deposit_spinner_text_tween: Tween
var _deposit_spinner_rotation_tween: Tween
var _deposit_spinner_timeout_tween: Tween
var _withdraw_spinner_text_tween: Tween
var _withdraw_spinner_rotation_tween: Tween
var _fun_credit_loading_tween: Tween
var _real_balance_loading_tween: Tween
var _fun_balance_text := "-"
var _real_balance_units := -1
var _is_ton_view := false
var _is_telegram_mini_app := false
var _wallet_connected := false
var _wallet_balance_text := "---"
var _selected_ton_tab := TON_TAB_TOP_UP
var _selected_denomination := 0
var _denomination_buttons: Array[TextureButton] = []
var _ton_button_rest_positions: Dictionary[BaseButton, Vector2] = {}
var _is_fun_credit_loading := false
var _is_real_balance_loading := false
var _fun_loading_frame := 0
var _real_balance_loading_frame := 0
var _add_credits_rest_position := Vector2.ZERO
var _alert_connect_rest_position := Vector2.ZERO
var _wallet_connect_rest_position := Vector2.ZERO
var _wallet_button_pressed := false
var _is_wallet_action_loading := false
var _wallet_action_loading_frame := 0
var _wallet_action_loading_tween: Tween
var _deposit_spinner_frame := 0
var _withdraw_spinner_frame := 0


func _ready() -> void:
	background.mouse_filter = Control.MOUSE_FILTER_IGNORE
	track.mouse_filter = Control.MOUSE_FILTER_IGNORE
	toggle.mouse_filter = Control.MOUSE_FILTER_IGNORE
	mouse_filter = Control.MOUSE_FILTER_STOP
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	alert.mouse_filter = Control.MOUSE_FILTER_STOP
	alert_backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	alert.visible = false
	alert.z_index = 20
	visible = false
	page.position = Vector2.ZERO

	close_button.pressed.connect(_on_close_button_pressed)
	toggle_hit_area.pressed.connect(_on_toggle_pressed)
	alert_close_button.pressed.connect(_on_alert_close_button_pressed)
	_alert_connect_rest_position = alert_connect_button.position
	alert_connect_button.button_down.connect(_on_alert_connect_button_down)
	alert_connect_button.button_up.connect(_on_alert_connect_button_up)
	alert_connect_button.focus_exited.connect(_on_alert_connect_button_up)
	alert_connect_button.pressed.connect(_on_alert_connect_button_pressed)

	_add_credits_rest_position = add_credits_button.position
	add_credits_button.button_down.connect(_on_add_credits_button_down)
	add_credits_button.button_up.connect(_on_add_credits_button_up)
	add_credits_button.focus_exited.connect(_on_add_credits_button_up)
	add_credits_button.pressed.connect(_on_add_credits_button_pressed)

	# Три верхние кнопки — вкладки, поэтому выбранная остаётся pressed.
	for button in [topup_tab_button, withdraw_tab_button, denom_tab_button]:
		button.toggle_mode = true
		_register_ton_press_feedback(button)
	topup_tab_button.pressed.connect(_on_ton_tab_pressed.bind(TON_TAB_TOP_UP))
	withdraw_tab_button.pressed.connect(_on_ton_tab_pressed.bind(TON_TAB_WITHDRAW))
	denom_tab_button.pressed.connect(_on_ton_tab_pressed.bind(TON_TAB_DENOM))

	_denomination_buttons = [denomination_001, denomination_01, denomination_1, denomination_10]
	for index in range(_denomination_buttons.size()):
		var button := _denomination_buttons[index]
		button.toggle_mode = true
		_register_ton_press_feedback(button)
		button.pressed.connect(_on_denomination_pressed.bind(index))
	# Submit отправляет собственный сигнал в Slots, который уже проигрывает
	# click.wav. Поэтому только смещение, без второго звука.
	_register_ton_press_feedback(topup_submit_button, false)
	_register_ton_press_feedback(withdraw_submit_button, false)
	_configure_amount_button(withdraw_all_amount_button)
	_register_ton_press_feedback(withdraw_all_amount_button)
	withdraw_all_amount_button.pressed.connect(_on_withdraw_all_amount_pressed)
	for button in topup_amount_buttons:
		# Суммы не являются переключателями: после тапа они только подставляют
		# значение в поле. На мобильном WebView не оставляем focus/pressed-стиль,
		# иначе последняя кнопка может визуально выглядеть залипшей.
		_configure_amount_button(button)
		_register_ton_press_feedback(button)
		button.pressed.connect(_on_topup_amount_selected.bind(button.text, button))
	topup_submit_button.pressed.connect(_on_topup_submit_pressed)
	withdraw_submit_button.pressed.connect(_on_withdraw_submit_pressed)
	topup_input.text_changed.connect(_on_topup_input_changed)
	withdraw_input.text_changed.connect(_on_withdraw_input_changed)
	_configure_decimal_input(topup_input, _apply_topup_decimal_input)
	_configure_decimal_input(withdraw_input, _apply_withdraw_decimal_input)

	# WalletConnectButton intentionally stays a Control: the visible panel and
	# label make up one large hit target instead of an additional invisible button.
	wallet_connect_button.mouse_filter = Control.MOUSE_FILTER_STOP
	wallet_connect_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	wallet_connect_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	wallet_connect_button.gui_input.connect(_on_wallet_connect_gui_input)
	_wallet_connect_rest_position = wallet_connect_button.position

	fun_status_banner.visible = false
	ton_status_banner.visible = false
	deposit_spinner.visible = false
	topup_input_container.visible = true
	withdraw_spinner.visible = false
	withdraw_input_container.visible = true
	profile_icon.texture = DEFAULT_PROFILE_ICON
	_select_denomination(0, false)
	_select_ton_tab(TON_TAB_TOP_UP)
	_show_fun_view()


## Shell сообщает presentation-среду. Это влияет лишь на интерфейс: API всё
## равно запрещает REAL-операции, пока Telegram и wallet proof не проверены.
func set_telegram_mini_app(value: bool) -> void:
	_is_telegram_mini_app = value


## Restores a Shell-owned mode selection after the Godot iframe was recreated.
## This must not emit mode_view_toggled: it is synchronization, not a new user
## gesture, and Slots already receives the same selected mode in shell:session.
func set_active_game_mode(is_ton_mode: bool) -> void:
	if is_ton_mode:
		_show_ton_view()
	else:
		_show_fun_view()


func open() -> void:
	if visible:
		return
	_stop_slide()
	visible = true
	page.position = Vector2(0.0, size.y)
	panel_open_state_changed.emit(true)
	_slide_to(Vector2.ZERO)


func close() -> void:
	if not visible:
		return
	WebBridge.dismiss_decimal_input()
	_stop_slide()
	_slide_to(Vector2(0.0, size.y))
	_slide_tween.tween_callback(_hide_after_close)


func set_fun_balance(value: Variant) -> void:
	_fun_balance_text = str(value) if value is int and value >= 0 else "-"
	_refresh_header_balance()


## real_balance must only be supplied by the server through Shell. The UI never
## derives or mutates it from an amount typed by the player.
func set_real_balance(value: Variant) -> void:
	_real_balance_units = value if value is int and value >= 0 else -1
	# A fresh server value may arrive while a deposit is still reconciling. Keep
	# it cached, but DepositSpinner owns the Header presentation until it ends.
	if _real_balance_units >= 0 and not _is_ton_balance_processing():
		_stop_real_balance_loading()
	else:
		_start_real_balance_loading()
	if _is_ton_view:
		_update_real_balance_labels()


## A submitted deposit must not leave a previous balance looking spendable.
## Shell ends this presentation state only with a fresh server balance/result.
func start_real_balance_pending() -> void:
	# Preserve the last server-confirmed balance, but do not show it as
	# spendable while an on-chain deposit is being reconciled.
	_start_real_balance_loading()


## Wallet data is display-only until the later API proof phase. `wallet_balance`
## is a formatted, non-authoritative value read by Shell; it is not game credit.
func set_wallet_state(connected: bool, wallet_balance: String = "---") -> void:
	_wallet_connected = connected
	_wallet_balance_text = _sanitize_gram_display(wallet_balance)
	# A TonConnect callback proves only that the wallet was selected. The RPC
	# balance may arrive a little later, after the Mini App gets focus again.
	# This also happens after the Godot iframe is recreated: its default label
	# is CONNECT WALLET, so explicitly restart --- here instead of briefly
	# showing that stale label before TopupBox becomes available.
	if connected and _wallet_balance_text == "---":
		set_wallet_action_loading(true)
	else:
		# A numeric balance, a disconnect, or an explicit Shell error ends the
		# transitional state and restores the appropriate ordinary label.
		set_wallet_action_loading(false)
	_update_wallet_ui()


## Shell explicitly controls this presentation state. Godot never infers a
## connected wallet from the animation and blocks repeat taps while it runs.
func set_wallet_action_loading(is_loading: bool) -> void:
	if _is_wallet_action_loading == is_loading:
		return

	_is_wallet_action_loading = is_loading
	_set_wallet_button_pressed(false)
	wallet_connect_button.mouse_filter = Control.MOUSE_FILTER_IGNORE if is_loading else Control.MOUSE_FILTER_STOP
	if is_loading:
		_wallet_action_loading_frame = 0
		_update_wallet_action_loading_label()
		_wallet_action_loading_tween = create_tween().set_loops()
		_wallet_action_loading_tween.tween_interval(0.12)
		_wallet_action_loading_tween.tween_callback(_advance_wallet_action_loading)
		return

	if _wallet_action_loading_tween != null and _wallet_action_loading_tween.is_valid():
		_wallet_action_loading_tween.kill()
	_wallet_action_loading_tween = null
	_update_wallet_ui()


## Default avatar is restored before every new Shell session. The actual photo
## arrives separately as bounded bytes through the authenticated API proxy.
func clear_profile_avatar() -> void:
	profile_icon.texture = DEFAULT_PROFILE_ICON


## Telegram's external CDN URL is never accepted here. The Shell sends image
## bytes only after API signature and MIME/size checks, then this final layer
## accepts one of the explicitly supported formats.
func set_profile_avatar_base64(content_type: String, encoded: String) -> void:
	if encoded.is_empty() or encoded.length() > MAX_PROFILE_AVATAR_BASE64_LENGTH:
		return

	var bytes := Marshalls.base64_to_raw(encoded)
	if bytes.is_empty() or bytes.size() > MAX_PROFILE_AVATAR_BYTES:
		return

	var image := Image.new()
	var load_error := ERR_INVALID_DATA
	match content_type:
		"image/jpeg":
			load_error = image.load_jpg_from_buffer(bytes)
		"image/png":
			load_error = image.load_png_from_buffer(bytes)
		"image/webp":
			load_error = image.load_webp_from_buffer(bytes)
		"image/svg+xml":
			load_error = image.load_svg_from_buffer(bytes)
		_:
			return

	if load_error != OK or image.is_empty():
		return
	profile_icon.texture = ImageTexture.create_from_image(image)


func set_fun_credit_action_enabled(enabled: bool) -> void:
	add_credits_button.disabled = not enabled
	if enabled:
		_stop_fun_credit_loading()
	else:
		_on_add_credits_button_up()
		_start_fun_credit_loading()


func show_fun_credit_success() -> void:
	_show_fun_status_banner(true)


## The FUN claim flow has two user-facing failures: a semantic rejection from
## the API and an ambiguous transport failure. The caller supplies the precise
## short message; this UI node only presents it.
func show_fun_credit_error(message := "CONNECTION ERROR. TRY AGAIN") -> void:
	fun_error_text.text = message
	_show_fun_status_banner(false)


func show_ton_success(message: String, is_withdrawal := false) -> void:
	# Итоговый TON-баннер — единая граница ожидания. Это покрывает ответ после
	# watcher, отмену Tonkeeper и восстановление pending-операции после reload.
	_finish_ton_processing()
	_show_ton_status_banner(true, message)
	if is_withdrawal:
		ton_withdrawal_confirmed.emit()


func show_ton_error(message: String) -> void:
	_finish_ton_processing()
	_show_ton_status_banner(false, message)


## Пока API и watcher подтверждают депозит, форма не должна оставаться
## доступной: повторный TOP-UP мог бы создать второй платёж. Это лишь UI;
## идемпотентность и окончательное зачисление всё равно контролирует сервер.
func show_topup_processing() -> void:
	WebBridge.dismiss_decimal_input()
	start_real_balance_pending()
	topup_input_container.visible = false
	deposit_spinner.visible = true
	_refresh_header_balance()
	_start_deposit_spinner_timeout()
	if _deposit_spinner_text_tween != null and _deposit_spinner_text_tween.is_valid():
		return
	_deposit_spinner_frame = 0
	_update_deposit_spinner_text()
	deposit_spinner_image.rotation = 0.0
	_deposit_spinner_text_tween = create_tween().set_loops()
	_deposit_spinner_text_tween.tween_interval(0.35)
	_deposit_spinner_text_tween.tween_callback(_advance_deposit_spinner_text)
	_deposit_spinner_rotation_tween = create_tween().set_loops()
	# Один полный оборот теперь занимает 1.8 секунды: вдвое спокойнее прежних
	# 0.9 секунды, без рывков благодаря линейной интерполяции.
	_deposit_spinner_rotation_tween.tween_property(deposit_spinner_image, "rotation", TAU, 1.8).as_relative().set_trans(Tween.TRANS_LINEAR)


## Вызывается только для терминального ответа Shell. Баннер показывается уже
## после возврата формы, поэтому игрок может сразу увидеть результат и сделать
## новую попытку, если платёж не был принят.
func finish_topup_processing() -> void:
	_stop_deposit_spinner_timeout()
	if _deposit_spinner_text_tween != null and _deposit_spinner_text_tween.is_valid():
		_deposit_spinner_text_tween.kill()
	_deposit_spinner_text_tween = null
	if _deposit_spinner_rotation_tween != null and _deposit_spinner_rotation_tween.is_valid():
		_deposit_spinner_rotation_tween.kill()
	_deposit_spinner_rotation_tween = null
	deposit_spinner_image.rotation = 0.0
	deposit_spinner.visible = false
	topup_input_container.visible = true
	_on_topup_input_changed(topup_input.text)
	# A terminal result returns the header to its latest trusted server value.
	# Shell immediately refreshes that value from API after a deposit outcome.
	_stop_real_balance_loading()
	_update_real_balance_labels()


## Withdrawal is a separate server command, but shares the same terminal UI
## rule as a deposit: as soon as StatusBanner receives a result, the form is
## restored and the spinner can no longer imply that money is still moving.
func show_withdraw_processing() -> void:
	WebBridge.dismiss_decimal_input()
	start_real_balance_pending()
	withdraw_input_container.visible = false
	withdraw_spinner.visible = true
	_refresh_header_balance()
	if _withdraw_spinner_text_tween != null and _withdraw_spinner_text_tween.is_valid():
		return
	_withdraw_spinner_frame = 0
	_update_withdraw_spinner_text()
	withdraw_spinner_image.rotation = 0.0
	_withdraw_spinner_text_tween = create_tween().set_loops()
	_withdraw_spinner_text_tween.tween_interval(0.35)
	_withdraw_spinner_text_tween.tween_callback(_advance_withdraw_spinner_text)
	_withdraw_spinner_rotation_tween = create_tween().set_loops()
	_withdraw_spinner_rotation_tween.tween_property(withdraw_spinner_image, "rotation", TAU, 1.8).as_relative().set_trans(Tween.TRANS_LINEAR)


func finish_withdraw_processing() -> void:
	if _withdraw_spinner_text_tween != null and _withdraw_spinner_text_tween.is_valid():
		_withdraw_spinner_text_tween.kill()
	_withdraw_spinner_text_tween = null
	if _withdraw_spinner_rotation_tween != null and _withdraw_spinner_rotation_tween.is_valid():
		_withdraw_spinner_rotation_tween.kill()
	_withdraw_spinner_rotation_tween = null
	withdraw_spinner_image.rotation = 0.0
	withdraw_spinner.visible = false
	withdraw_input_container.visible = true
	_on_withdraw_input_changed(withdraw_input.text)
	_stop_real_balance_loading()
	_update_real_balance_labels()


func _finish_ton_processing() -> void:
	finish_topup_processing()
	finish_withdraw_processing()


func _start_deposit_spinner_timeout() -> void:
	_stop_deposit_spinner_timeout()
	_deposit_spinner_timeout_tween = create_tween()
	_deposit_spinner_timeout_tween.tween_interval(deposit_spinner_timeout)
	_deposit_spinner_timeout_tween.tween_callback(_on_deposit_spinner_timeout)


func _stop_deposit_spinner_timeout() -> void:
	if _deposit_spinner_timeout_tween != null and _deposit_spinner_timeout_tween.is_valid():
		_deposit_spinner_timeout_tween.kill()
	_deposit_spinner_timeout_tween = null


func _on_deposit_spinner_timeout() -> void:
	_deposit_spinner_timeout_tween = null
	if not deposit_spinner.visible:
		return
	# This ends only the local visual wait. A TON transfer cannot be cancelled
	# here; Shell/Watcher continue durable reconciliation and can still report a
	# later CREDITS ADDED result.
	show_ton_error("SOMETHING WENT WRONG")


func _advance_deposit_spinner_text() -> void:
	_deposit_spinner_frame = (_deposit_spinner_frame + 1) % DEPOSIT_PROCESSING_FRAMES.size()
	_update_deposit_spinner_text()


func _update_deposit_spinner_text() -> void:
	deposit_spinner_text.text = DEPOSIT_PROCESSING_FRAMES[_deposit_spinner_frame]


func _advance_withdraw_spinner_text() -> void:
	_withdraw_spinner_frame = (_withdraw_spinner_frame + 1) % WITHDRAW_PROCESSING_FRAMES.size()
	_update_withdraw_spinner_text()


func _update_withdraw_spinner_text() -> void:
	withdraw_spinner_text.text = WITHDRAW_PROCESSING_FRAMES[_withdraw_spinner_frame]


func set_ton_action_enabled(action: String, enabled: bool) -> void:
	match action:
		"top_up": topup_submit_button.disabled = not enabled
		"withdraw": withdraw_submit_button.disabled = not enabled


func _on_close_button_pressed() -> void:
	close()
	close_pressed.emit()


func _on_toggle_pressed() -> void:
	if _is_ton_view:
		_show_fun_view()
		mode_view_toggled.emit(false)
		return

	_show_ton_view()
	# A Telegram Mini App can browse TON UI even before a wallet is linked. The
	# legacy browser guest gets the explanatory Alert and remains in FUN mode.
	if _is_telegram_mini_app:
		mode_view_toggled.emit(true)
	else:
		show_ton_connect_alert()
		ton_connect_alert_opened.emit()


func show_ton_connect_alert() -> void:
	if alert.visible:
		return
	alert.visible = true
	alert_connect_button.position = _alert_connect_rest_position


func _hide_ton_connect_alert() -> void:
	alert.visible = false
	alert_connect_button.position = _alert_connect_rest_position
	_show_fun_view()
	mode_view_toggled.emit(false)


func _on_alert_close_button_pressed() -> void:
	_hide_ton_connect_alert()
	close_pressed.emit()


func _on_alert_connect_button_down() -> void:
	alert_connect_button.position = _alert_connect_rest_position + connect_pressed_offset


func _on_alert_connect_button_up() -> void:
	alert_connect_button.position = _alert_connect_rest_position


func _on_alert_connect_button_pressed() -> void:
	_on_alert_connect_button_up()
	ton_connect_requested.emit()


func _on_ton_tab_pressed(tab: int) -> void:
	_select_ton_tab(tab)


func _select_ton_tab(tab: int) -> void:
	WebBridge.dismiss_decimal_input()
	_selected_ton_tab = tab
	topup_tab_button.button_pressed = tab == TON_TAB_TOP_UP
	withdraw_tab_button.button_pressed = tab == TON_TAB_WITHDRAW
	denom_tab_button.button_pressed = tab == TON_TAB_DENOM
	# DENOM is always accessible. The financial forms are hidden until a wallet
	# is connected; their submit action is separately revalidated by API later.
	topup_box.visible = tab == TON_TAB_TOP_UP and _wallet_connected
	withdraw_box.visible = tab == TON_TAB_WITHDRAW and _wallet_connected
	denom_box.visible = tab == TON_TAB_DENOM
	_update_wallet_ui()


func _update_wallet_ui() -> void:
	if not _is_wallet_action_loading:
		wallet_connect_label.text = "DISCONNECT WALLET I->" if _wallet_connected else "CONNECT WALLET 1<-"
	wallet_balance_value.text = "%s GRAM" % _wallet_balance_text
	available_withdraw_value.text = "%s GRAM" % _format_real_balance()
	if _is_ton_view:
		topup_box.visible = _selected_ton_tab == TON_TAB_TOP_UP and _wallet_connected
		withdraw_box.visible = _selected_ton_tab == TON_TAB_WITHDRAW and _wallet_connected
		denom_box.visible = _selected_ton_tab == TON_TAB_DENOM


func _on_wallet_connect_gui_input(event: InputEvent) -> void:
	if _is_wallet_action_loading:
		accept_event()
		return
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_set_wallet_button_pressed(true)
		else:
			_request_wallet_action()
		accept_event()
	elif event is InputEventScreenTouch:
		if event.pressed:
			_set_wallet_button_pressed(true)
		else:
			_request_wallet_action()
		accept_event()


func _set_wallet_button_pressed(pressed: bool) -> void:
	_wallet_button_pressed = pressed
	wallet_connect_button.position = _wallet_connect_rest_position + connect_pressed_offset if pressed else _wallet_connect_rest_position


func _request_wallet_action() -> void:
	if not _wallet_button_pressed:
		return
	_set_wallet_button_pressed(false)
	if _wallet_connected:
		ton_disconnect_requested.emit()
	else:
		ton_connect_requested.emit()


func _advance_wallet_action_loading() -> void:
	_wallet_action_loading_frame = (_wallet_action_loading_frame + 1) % LOADING_FRAMES.size()
	_update_wallet_action_loading_label()


func _update_wallet_action_loading_label() -> void:
	if _is_wallet_action_loading:
		wallet_connect_label.text = LOADING_FRAMES[_wallet_action_loading_frame]


func _on_denomination_pressed(index: int) -> void:
	_select_denomination(index, true)


func _select_denomination(index: int, should_emit: bool) -> void:
	if index < 0 or index >= _denomination_buttons.size():
		return
	_selected_denomination = index
	for button_index in range(_denomination_buttons.size()):
		_denomination_buttons[button_index].button_pressed = button_index == index
	_update_current_denomination_value()
	if should_emit:
		denomination_selected.emit(index, DENOMINATION_API_VALUES[index])


func _on_topup_input_changed(_text: String) -> void:
	topup_submit_button.disabled = _parse_input_amount_to_units(topup_input.text) < MINIMUM_TOP_UP_UNITS


func _on_topup_amount_selected(amount: String, button: Button) -> void:
	# Кнопка суммы заменяет уже введённое значение целиком. Так пользователь не
	# получит случайно склеенную строку вроде "0.15" после выбора "5".
	# `pressed` приходит уже после отпускания пальца/мыши. Сбрасываем визуальное
	# смещение здесь дополнительно: на мобильном WebView событие button_up иногда
	# не доходит, если палец ушёл за границу сдвинутой кнопки.
	_on_ton_button_up(button)
	button.button_pressed = false
	button.release_focus()
	# `pressed` приходит во время обработки события. Сбрасываем его повторно в
	# следующем кадре: это покрывает iOS WebView, где touch-end иногда рисуется
	# после пользовательского обработчика.
	button.set_deferred("button_pressed", false)
	WebBridge.dismiss_decimal_input()
	_apply_topup_decimal_input(amount)


func _on_withdraw_input_changed(_text: String) -> void:
	var units := _parse_input_amount_to_units(withdraw_input.text)
	withdraw_submit_button.disabled = units < MINIMUM_WITHDRAW_UNITS or units > _real_balance_units


func _on_withdraw_all_amount_pressed() -> void:
	# The stored value is authoritative server data in canonical units. We only
	# format it to the two decimals the withdrawal API accepts; no float math.
	_on_ton_button_up(withdraw_all_amount_button)
	withdraw_all_amount_button.button_pressed = false
	withdraw_all_amount_button.release_focus()
	withdraw_all_amount_button.set_deferred("button_pressed", false)
	if _real_balance_units < MINIMUM_WITHDRAW_UNITS:
		show_ton_error("MINIMUM WITHDRAW 0.1 GRAM")
		return
	WebBridge.dismiss_decimal_input()
	_apply_withdraw_decimal_input(_format_real_balance())


func _configure_decimal_input(input: LineEdit, receiver: Callable) -> void:
	# The Web export has a dedicated DOM input bridge. Disable only Godot's
	# experimental soft-keyboard path; normal desktop keyboard input still works.
	input.virtual_keyboard_enabled = false
	input.virtual_keyboard_show_on_focus = false
	if not OS.has_feature("web"):
		return

	# A gui_input connection on LineEdit runs after the control has already
	# handled the tap. On mobile Web this can focus Godot's hidden text input
	# (a plain text keyboard) before our DOM bridge runs. A transparent sibling
	# gets the touch first, while LineEdit remains responsible for rendering the
	# field and validating the resulting text.
	input.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var web_hit_area := Control.new()
	web_hit_area.name = "%sWebInputHitArea" % input.name
	web_hit_area.position = input.position
	web_hit_area.size = input.size
	web_hit_area.z_index = input.z_index + 1
	web_hit_area.mouse_filter = Control.MOUSE_FILTER_STOP
	input.get_parent().add_child(web_hit_area)
	web_hit_area.gui_input.connect(_on_decimal_input_hit_area_gui_input.bind(input, receiver))


func _on_decimal_input_hit_area_gui_input(event: InputEvent, input: LineEdit, receiver: Callable) -> void:
	var is_touch := false
	var is_left_click := false
	if event is InputEventScreenTouch:
		var touch_event := event as InputEventScreenTouch
		is_touch = touch_event.pressed
	elif event is InputEventMouseButton:
		var mouse_event := event as InputEventMouseButton
		is_left_click = mouse_event.button_index == MOUSE_BUTTON_LEFT and mouse_event.pressed
	if not is_touch and not is_left_click:
		return
	input.grab_focus()
	if WebBridge.request_decimal_input(input.text, input.max_length, receiver):
		accept_event()


func _apply_topup_decimal_input(raw_value: String) -> void:
	_apply_decimal_input_text(topup_input, raw_value)
	_on_topup_input_changed(topup_input.text)


func _apply_withdraw_decimal_input(raw_value: String) -> void:
	_apply_decimal_input_text(withdraw_input, raw_value)
	_on_withdraw_input_changed(withdraw_input.text)


func _apply_decimal_input_text(input: LineEdit, raw_value: String) -> void:
	# `.text =` intentionally does not emit text_changed, so each caller invokes
	# its own validation after synchronising the native mobile field.
	input.text = _normalise_input_amount(raw_value)
	input.caret_column = input.text.length()


func _on_topup_submit_pressed() -> void:
	WebBridge.dismiss_decimal_input()
	var units := _parse_input_amount_to_units(topup_input.text)
	if units < MINIMUM_TOP_UP_UNITS:
		show_ton_error("MINIMUM TOP-UP 0.1 GRAM")
		return
	show_topup_processing()
	ton_top_up_requested.emit(_normalise_input_amount(topup_input.text))


func _on_withdraw_submit_pressed() -> void:
	WebBridge.dismiss_decimal_input()
	var units := _parse_input_amount_to_units(withdraw_input.text)
	if units < MINIMUM_WITHDRAW_UNITS:
		show_ton_error("MINIMUM WITHDRAW 0.1 GRAM")
		return
	if _real_balance_units < 0 or units > _real_balance_units:
		show_ton_error("INSUFFICIENT AVAILABLE BALANCE")
		return
	show_withdraw_processing()
	ton_withdraw_requested.emit(_normalise_input_amount(withdraw_input.text))


## Inputs are presentation validation only. The API repeats this parsing with
## bigint/nanotons and applies limits, wallet proof and balance locking.
func _parse_input_amount_to_units(raw_text: String) -> int:
	var normalised := _normalise_input_amount(raw_text)
	if normalised.is_empty():
		return -1
	var regex := RegEx.new()
	regex.compile("^[0-9]+(?:\\.[0-9]{1,2})?$")
	if regex.search(normalised) == null:
		return -1
	var parts := normalised.split(".", false)
	var whole := parts[0].to_int()
	var hundredths := 0
	if parts.size() == 2:
		var fraction: String = parts[1]
		hundredths = fraction.to_int() * (10 if fraction.length() == 1 else 1)
	# 0.01 TON = 10 canonical units. Input is deliberately converted without
	# floats, including on Web builds.
	return (whole * 100 + hundredths) * REAL_BALANCE_MIN_UNIT


func _normalise_input_amount(raw_text: String) -> String:
	return raw_text.strip_edges().replace(",", ".")


func _register_ton_press_feedback(button: BaseButton, emit_click: bool = true) -> void:
	_ton_button_rest_positions[button] = button.position
	button.button_down.connect(_on_ton_button_down.bind(button))
	button.button_up.connect(_on_ton_button_up.bind(button))
	button.focus_exited.connect(_on_ton_button_up.bind(button))
	# Вкладки, номиналы и submit используют один маршрут: сначала стандартное
	# смещение вниз, затем ровно один click.wav через Slots.
	if emit_click:
		button.pressed.connect(_on_ton_button_pressed)


func _configure_amount_button(button: Button) -> void:
	button.toggle_mode = false
	button.focus_mode = Control.FOCUS_NONE
	# В сцене для сумм определён только normal. На iOS WebView после тапа может
	# остаться системный hover/pressed StyleBox — это и даёт тёмную «залипшую»
	# кнопку на скриншоте. Во все отображаемые состояния подставляем normal;
	# краткая обратная связь остаётся за счёт смещения кнопки вниз.
	var normal_style := button.get_theme_stylebox("normal")
	if normal_style != null:
		for state in ["normal", "hover", "pressed", "disabled", "focus"]:
			button.add_theme_stylebox_override(state, normal_style)


func _on_ton_button_pressed() -> void:
	ton_ui_clicked.emit()


func _on_ton_button_down(button: BaseButton) -> void:
	button.position = _ton_button_rest_positions[button] + ton_pressed_offset


func _on_ton_button_up(button: BaseButton) -> void:
	button.position = _ton_button_rest_positions[button]


func _on_add_credits_button_down() -> void:
	add_credits_button.position = _add_credits_rest_position + fun_credit_pressed_offset


func _on_add_credits_button_up() -> void:
	add_credits_button.position = _add_credits_rest_position


func _on_add_credits_button_pressed() -> void:
	set_fun_credit_action_enabled(false)
	fun_credits_requested.emit()


func _start_fun_credit_loading() -> void:
	if _is_fun_credit_loading:
		return
	_is_fun_credit_loading = true
	_fun_loading_frame = 0
	_refresh_header_balance()
	_fun_credit_loading_tween = create_tween().set_loops()
	_fun_credit_loading_tween.tween_interval(0.12)
	_fun_credit_loading_tween.tween_callback(_advance_fun_credit_loading)


func _advance_fun_credit_loading() -> void:
	_fun_loading_frame = (_fun_loading_frame + 1) % LOADING_FRAMES.size()
	_refresh_header_balance()


func _stop_fun_credit_loading() -> void:
	_is_fun_credit_loading = false
	if _fun_credit_loading_tween != null and _fun_credit_loading_tween.is_valid():
		_fun_credit_loading_tween.kill()
	_refresh_header_balance()


func _start_real_balance_loading() -> void:
	if _is_real_balance_loading:
		return
	_is_real_balance_loading = true
	_real_balance_loading_frame = 0
	_refresh_header_balance()
	_real_balance_loading_tween = create_tween().set_loops()
	_real_balance_loading_tween.tween_interval(0.12)
	_real_balance_loading_tween.tween_callback(_advance_real_balance_loading)


func _advance_real_balance_loading() -> void:
	_real_balance_loading_frame = (_real_balance_loading_frame + 1) % LOADING_FRAMES.size()
	_refresh_header_balance()


func _stop_real_balance_loading() -> void:
	_is_real_balance_loading = false
	if _real_balance_loading_tween != null and _real_balance_loading_tween.is_valid():
		_real_balance_loading_tween.kill()
	_real_balance_loading_tween = null


func _show_fun_status_banner(is_success: bool) -> void:
	if _fun_status_tween != null and _fun_status_tween.is_valid():
		_fun_status_tween.kill()
	fun_success_banner.visible = is_success
	fun_success_text.visible = is_success
	fun_error_banner.visible = not is_success
	fun_error_text.visible = not is_success
	fun_status_banner.visible = true
	fun_status_banner.z_index = 10
	_fade_and_hide_banner(fun_status_banner, _hide_fun_status_banner, "fun")


func _hide_fun_status_banner() -> void:
	fun_status_banner.visible = false
	fun_status_banner.modulate = Color.WHITE


func _show_ton_status_banner(is_success: bool, message: String) -> void:
	# StatusBanner is the terminal visual boundary of both monetary actions.
	# Keep this defensive call here so a future caller cannot leave either
	# spinner running behind a terminal success or error message.
	if _is_ton_balance_processing():
		_finish_ton_processing()
	if _ton_status_tween != null and _ton_status_tween.is_valid():
		_ton_status_tween.kill()
	ton_success_banner.visible = is_success
	ton_error_banner.visible = not is_success
	ton_status_text.text = message
	ton_status_text.visible = true
	ton_status_banner.visible = true
	ton_status_banner.z_index = 10
	_fade_and_hide_banner(ton_status_banner, _hide_ton_status_banner, "ton")


func _hide_ton_status_banner() -> void:
	ton_status_banner.visible = false
	ton_status_banner.modulate = Color.WHITE


func _fade_and_hide_banner(target: Control, finished: Callable, kind: String) -> void:
	target.modulate = Color(1.0, 1.0, 1.0, 0.0)
	var fade_duration := minf(0.2, status_banner_duration * 0.25)
	var hold_duration := maxf(0.0, status_banner_duration - fade_duration * 2.0)
	var tween := create_tween()
	tween.tween_property(target, "modulate:a", 1.0, fade_duration)
	tween.tween_interval(hold_duration)
	tween.tween_property(target, "modulate:a", 0.0, fade_duration)
	tween.tween_callback(finished)
	if kind == "fun":
		_fun_status_tween = tween
	else:
		_ton_status_tween = tween


func _show_fun_view() -> void:
	_is_ton_view = false
	balance_title.text = "FUN BALANCE"
	currency_icon.texture = FUN_ICON
	_refresh_header_balance()
	fun_label.add_theme_color_override("font_color", ACTIVE_LABEL_COLOR)
	ton_label.add_theme_color_override("font_color", INACTIVE_LABEL_COLOR)
	fun_content.visible = true
	ton_content.visible = false
	_move_toggle(TOGGLE_FUN_POSITION)


func _show_ton_view() -> void:
	_is_ton_view = true
	balance_title.text = "GRAM BALANCE"
	currency_icon.texture = TON_ICON
	fun_label.add_theme_color_override("font_color", INACTIVE_LABEL_COLOR)
	ton_label.add_theme_color_override("font_color", ACTIVE_LABEL_COLOR)
	fun_content.visible = false
	ton_content.visible = true
	_select_ton_tab(_selected_ton_tab)
	_update_real_balance_labels()
	if _real_balance_units < 0 or _is_real_balance_loading:
		_start_real_balance_loading()
	_move_toggle(TOGGLE_TON_POSITION)


func _format_real_balance() -> String:
	if _real_balance_units < 0:
		return "---"
	var whole_ton := _real_balance_units / REAL_BALANCE_UNITS_PER_TON
	var hundredths := (_real_balance_units % REAL_BALANCE_UNITS_PER_TON) / REAL_BALANCE_MIN_UNIT
	return "%d.%02d" % [whole_ton, hundredths]


func _sanitize_gram_display(value: String) -> String:
	if value == "---":
		return value
	var units := _parse_input_amount_to_units(value)
	if units < 0:
		return "---"
	var whole := units / REAL_BALANCE_UNITS_PER_TON
	var hundredths := (units % REAL_BALANCE_UNITS_PER_TON) / REAL_BALANCE_MIN_UNIT
	return "%d.%02d" % [whole, hundredths]


func _update_real_balance_labels() -> void:
	_update_current_denomination_value()
	available_withdraw_value.text = "%s GRAM" % _format_real_balance()
	_refresh_header_balance()
	_update_wallet_ui()


## Header balance is rendered in one place. This prevents panel redraws,
## deposit processing and API balance updates from overwriting each other.
func _refresh_header_balance() -> void:
	if _is_ton_view:
		# A pending TON operation owns the Header presentation. API may update the
		# cached balance in the meantime, but a player must never see it before the
		# terminal StatusBanner has appeared.
		if _is_ton_balance_processing() or _is_real_balance_loading or _real_balance_units < 0:
			balance_value.text = LOADING_FRAMES[_real_balance_loading_frame]
		else:
			balance_value.text = _format_real_balance()
		return
	balance_value.text = LOADING_FRAMES[_fun_loading_frame] if _is_fun_credit_loading else _fun_balance_text


func _is_topup_processing() -> bool:
	return deposit_spinner.visible


func _is_ton_balance_processing() -> bool:
	return deposit_spinner.visible or withdraw_spinner.visible


func _update_current_denomination_value() -> void:
	if _real_balance_units < 0:
		denomination_value.text = "---"
		return
	var credits: int = _real_balance_units / DENOMINATION_CREDIT_DIVISORS[_selected_denomination]
	credits = (credits / MINIMUM_BET_CREDITS) * MINIMUM_BET_CREDITS
	denomination_value.text = "%s GRAM = %d CRED" % [_format_real_balance(), credits]


func _move_toggle(target_position: Vector2) -> void:
	if _toggle_tween != null and _toggle_tween.is_valid():
		_toggle_tween.kill()
	_toggle_tween = create_tween()
	_toggle_tween.set_trans(Tween.TRANS_QUAD)
	_toggle_tween.set_ease(Tween.EASE_OUT)
	_toggle_tween.tween_property(toggle, "position", target_position, 0.16)


func _slide_to(target_position: Vector2) -> void:
	_slide_tween = create_tween()
	_slide_tween.set_trans(Tween.TRANS_QUAD)
	_slide_tween.set_ease(Tween.EASE_IN_OUT)
	_slide_tween.tween_property(page, "position", target_position, slide_duration)


func _stop_slide() -> void:
	if _slide_tween != null and _slide_tween.is_valid():
		_slide_tween.kill()


func _hide_after_close() -> void:
	visible = false
	page.position = Vector2.ZERO
	panel_open_state_changed.emit(false)
