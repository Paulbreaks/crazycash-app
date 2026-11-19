extends Control

## Статусы игры, которые могут менять бегущую строку.
## Здесь нет сетевых запросов: позднее shell bridge передаст сюда уже готовый
## результат авторизации, баланс и результат спина.
enum MarqueeStatus {
	AUTH_REQUIRED,
	AUTH_ERROR,
	FUN_READY,
	REAL_READY,
	INSUFFICIENT_BALANCE,
	SPINNING,
	LOSS,
	TRY_AGAIN,
	WIN,
}

# Обычный цикл, который игрок видит в состоянии готовности к спину.
const FUN_READY_MESSAGES := [
	"BET %d",
	"FUN MODE",
	"PRESS PLAY",
]
const REAL_READY_MESSAGES := [
	"BET %d",
	"PRESS PLAY",
]
# Активные номиналы в интерфейсе. Чтобы вернуть ставку 1 позже, добавьте её
# первым элементом: [1, 10, 100, 1000], затем сдвиньте привязки звуков на один
# номинал: 1 → bet1, 10 → bet2, 100 → bet3, 1000 → bet4.
const BET_VALUES: Array[int] = [10, 100, 1000]
const REAL_DENOMINATION_DIVISORS: Array[int] = [1, 10, 100, 1000]
const REAL_DENOMINATION_VALUES: Array[String] = ["0.01", "0.1", "1", "10"]
const MINIMUM_BET_CREDITS := 10
const REEL_SPIN_LOOPS := 2
const REEL_STOP_DELAY_SECONDS := 0.18
const PRE_SPINNING_STEP_SECONDS := 0.16
const SPIN_RESPONSE_TIMEOUT_SECONDS := 5.0
# Пять секунд — UX-порог: игроку сразу сообщаем о проблеме с сетью. Это не
# означает, что сервер не завершил идемпотентный запрос: Shell ещё сверяет его
# по requestId. Держим раунд заблокированным до терминального ответа Shell,
# но не более этого аварийного лимита.
const SPIN_RECONCILIATION_GRACE_SECONDS := 15.0
# Пока Shell получает /me/session, главное поле BAL не должно создавать
# впечатление, что у игрока нулевой баланс. Три позиции повторяют индикатор
# ожидания в MODE-панели, но принадлежат именно главному игровому экрану.
const INITIAL_BALANCE_LOADING_FRAMES := ["-  ", " - ", "  -"]
const INITIAL_BALANCE_LOADING_STEP_SECONDS := 0.12
# Младшие правила выигрыша начисляются быстрее. Сервер по-прежнему передаёт
# итоговую выплату и баланс; это влияет только на длительность UI-анимации.
const SMALL_WIN_RULES: Array[String] = ["0XX", "7XX", "00X", "55X", "77X"]

@export var current_bet := 10
@export var current_balance := 0

@onready var running_text: RunningText = $RunningText
@onready var buttons: SlotButtons = $"../Cabinet/Buttons"
@onready var win_flash: WinFlash = $"../Cabinet/WinFlash"
@onready var win_counter: WinCounter = $WinCounter
@onready var logo: AnimatedSprite2D = $"../Cabinet/Dashboard/Logo"
@onready var session_expired_alert: SessionExpiredAlert = $"../../AlertSessionExpired"
# Явный тип вместо базового Control делает публичный контракт панели видимым:
# здесь разрешены только методы и сигналы ModePanel, а не произвольные call().
@onready var mode_panel: ModePanel = $"../../ModePanel"
@onready var big_win_sound: AudioStreamPlayer = $BigWinSound
@onready var small_win_sound: AudioStreamPlayer = $SmallWinSound
@onready var big_cashout_sound: AudioStreamPlayer = $BigCashoutSound
@onready var small_cashout_sound: AudioStreamPlayer = $SmallCashoutSound
@onready var reel_spin_sound: AudioStreamPlayer = $ReelSpinSound
@onready var click_sound: AudioStreamPlayer = $ClickSound
@onready var credits_granted_sound: AudioStreamPlayer = $CreditsGrantedSound
# Звуки выбора ставки. Каждый соответствует уже новой ставке после нажатия BET.
@onready var bet_10_sound: AudioStreamPlayer = $Bet10Sound
@onready var bet_100_sound: AudioStreamPlayer = $Bet100Sound
@onready var bet_1000_sound: AudioStreamPlayer = $Bet1000Sound
@onready var bet_value_label: Label = $BetText/BetValue
@onready var balance_value_label: Label = $BalanceText/BalanceValue
# Все барабаны собраны в CanvasGroup Numbers, чтобы один ShaderMaterial мог
# применяться сразу к трём цифрам. Пути должны соответствовать новой иерархии.
@onready var reels: Array[AnimatedSprite2D] = [$Numbers/FirstNumber, $Numbers/SecondNumber, $Numbers/ThirdNumber]

var _marquee_status := MarqueeStatus.FUN_READY
var _ready_message_index := 0
var _current_mode := "fun"
## This comes only from the authenticated API session. It is a UX gate; every
## REAL spin is independently authorized again by the API.
var _real_mode_available := false
var _fun_balance := 0
# Canonical internal TON units from API: 1 unit = 0.001 TON.
var _real_balance_units := 0
var _selected_real_denomination := 0
var _is_spin_in_progress := false
var _is_revealing_result := false
var _pre_spinning_tween: Tween
var _pre_spinning_reel_index := 0
var _spin_request_serial := 0
var _active_game_request_id := ""
var _spin_response_timeout: SceneTreeTimer
var _spin_reconciliation_timeout: SceneTreeTimer
var _is_waiting_for_spin_reconciliation := false
var _balance_before_spin := 0
var _pending_result_multiplier := 0
var _pending_result_payout := 0
var _pending_result_rule := ""
# Данные уже подтверждённого сервером результата. Нужны, чтобы PLAY мог
# мгновенно завершить визуальную прокрутку барабанов без нового API-запроса.
var _result_digits: Array[int] = []
var _result_balance := 0
var _reveal_sequence_id := 0
var _skip_reveal_after_response := false
var _win_presentation_id := 0
# Не даёт повторно запустить звук выигрыша, когда после третьего барабана
# начнётся отдельная подача WON и WinFlash.
var _win_sound_started_for_result := false
# Индикатор существует только до первого ответа shell:session. Серверный
# баланс никогда не выводится из этого состояния и остаётся источником истины.
var _is_initial_balance_loading := false
var _initial_balance_loading_frame := 0
var _initial_balance_loading_tween: Tween

func _ready() -> void:
	_update_value_labels()
	_start_initial_balance_loading()
	_show_default_logo()
	# Slots готов раньше соседнего Cabinet/Buttons, поэтому ждём его _ready.
	# До shell:session игра ещё не готова: MODE нельзя открыть поверх загрузки.
	buttons.set_mode_enabled.call_deferred(false)
	WebBridge.start_listening(_on_shell_message)
	running_text.message_finished.connect(_on_running_text_message_finished)
	# Buttons сообщает только о нажатии; Slots формирует осмысленное событие
	# с текущими игровыми значениями и передаёт его наружу через WebBridge.
	buttons.bet_requested.connect(_on_bet_requested)
	buttons.play_requested.connect(_on_play_requested)
	buttons.mode_requested.connect(_on_mode_requested)
	mode_panel.close_pressed.connect(_on_mode_panel_close_pressed)
	mode_panel.panel_open_state_changed.connect(_on_mode_panel_open_state_changed)
	mode_panel.mode_view_toggled.connect(_on_mode_panel_view_toggled)
	mode_panel.fun_credits_requested.connect(_on_fun_credits_requested)
	mode_panel.ton_connect_requested.connect(_on_ton_connect_requested)
	mode_panel.ton_disconnect_requested.connect(_on_ton_disconnect_requested)
	mode_panel.ton_top_up_requested.connect(_on_ton_top_up_requested)
	mode_panel.ton_withdraw_requested.connect(_on_ton_withdraw_requested)
	mode_panel.ton_withdrawal_confirmed.connect(_on_ton_withdrawal_confirmed)
	mode_panel.ton_connect_alert_opened.connect(_on_ton_connect_alert_opened)
	mode_panel.ton_ui_clicked.connect(_on_ton_ui_clicked)
	mode_panel.denomination_selected.connect(_on_denomination_selected)
	session_expired_alert.dismissed.connect(_on_session_expired_alert_dismissed)
	session_expired_alert.play_again_requested.connect(_on_session_expired_play_again_requested)

	_announce_shell_ready()
	# До shell:session не показываем FUN MODE из шаблона сцены. Иначе строка
	# успевает один раз стартовать и тут же перезапускается ответом API.


func _on_bet_requested() -> void:
	# На всякий случай дублируем защиту UI: ставка активного серверного спина
	# меняться не должна, даже если сигнал придёт до применения disabled.
	if _is_spin_in_progress:
		return

	var should_restart_ready_marquee := _marquee_status == MarqueeStatus.FUN_READY \
		or _marquee_status == MarqueeStatus.REAL_READY \
		or _marquee_status == MarqueeStatus.LOSS \
		or _marquee_status == MarqueeStatus.TRY_AGAIN \
		or _marquee_status == MarqueeStatus.WIN \
		or _marquee_status == MarqueeStatus.INSUFFICIENT_BALANCE
	if _marquee_status == MarqueeStatus.WIN:
		# Ставка прерывает оставшееся оформление выигрыша, но финальный баланс
		# всё равно берётся из уже полученного API-ответа.
		_complete_win_presentation_immediately()
		win_flash.clear()

	var current_index := BET_VALUES.find(current_bet)
	var next_index := (current_index + 1) % BET_VALUES.size()
	# Если ставку изменят в Inspector на значение вне списка, BET безопасно
	# вернёт её к первому допустимому варианту — 10.
	if current_index == -1:
		next_index = 0

	current_bet = BET_VALUES[next_index]
	_update_value_labels()
	# Проигрываем звук именно выбранной ставки: 10 → bet1, 100 → bet2,
	# 1000 → bet3. Это только UI-отклик, не решение сервера.
	_play_bet_change_sound()
	if should_restart_ready_marquee:
		_show_ready_marquee()

	WebBridge.post_to_shell({
		"type": "game:betRequested",
		"payload": {
			"currentBet": current_bet,
			"mode": _current_mode,
		},
	})


## Принимает уже проверенное Shell состояние. Игра не делает HTTP-запросов и
## не доверяет себе баланс: сервер передаёт его через Shell после /me/session.
func _on_shell_message(message: Dictionary) -> void:
	match message.get("type"):
		# shell:init is an idempotent handshake request. It is intentionally
		# supported after _ready: iOS Safari may restore React and this iframe at
		# different moments, so the first game:ready could have been missed.
		"shell:init":
			_announce_shell_ready()
		"shell:session":
			_apply_shell_session(message.get("payload"))
		"shell:profileAvatar":
			_apply_shell_profile_avatar(message.get("payload"))
		"shell:sessionExpired":
			_show_session_expired_alert()
		"shell:balances":
			_apply_shell_balances(message.get("payload"))
		"shell:walletState":
			_apply_shell_wallet_state(message.get("payload"))
		"shell:walletActionState":
			_apply_shell_wallet_action_state(message.get("payload"))
		"shell:tonConnectError":
			_apply_ton_connect_error(message.get("payload"))
		"shell:tonOperationResult":
			_apply_ton_operation_result(message.get("payload"))
		"shell:spinResult":
			_apply_spin_result(message.get("payload"))
		"shell:spinError":
			_apply_spin_error(message.get("payload"))
		"shell:funCreditsResult":
			_apply_fun_credits_result(message.get("payload"))
		"shell:funCreditsError":
			_apply_fun_credits_error(message.get("payload"))


func _announce_shell_ready() -> void:
	WebBridge.post_to_shell({
		"type": "game:ready",
		"payload": {"engine": "godot"},
	})


func _apply_shell_session(payload: Variant) -> void:

	if not payload is Dictionary:
		show_authorization_error()
		return

	if payload.get("authorized") != true:
		show_authorization_required()
		return

	var mode = payload.get("activeMode", "fun")
	if mode != "fun" and mode != "real":
		show_authorization_error()
		return

	var balances = payload.get("balances")
	if not balances is Dictionary or not balances.has(mode):
		show_authorization_error()
		return

	var fun_balance := _parse_balance(balances.get("fun"))
	var real_balance := _parse_balance(balances.get("real"))
	if fun_balance < 0 or real_balance < 0:
		show_authorization_error()
		return
	_fun_balance = fun_balance
	_real_balance_units = real_balance
	var real_mode_available = payload.get("realModeAvailable", false)
	if not real_mode_available is bool:
		show_authorization_error()
		return
	_real_mode_available = real_mode_available
	# Shell derives this from the signed Telegram Mini App context. This is only
	# a presentation hint: it never grants REAL permissions at API level.
	mode_panel.set_telegram_mini_app(payload.get("surface") == "telegram")
	# A restored iframe can otherwise retain an avatar from an older session.
	# The optional shell:profileAvatar event will replace this default shortly.
	mode_panel.clear_profile_avatar()
	# ModePanel всегда показывает FUN-баланс отдельно от активного игрового режима.
	mode_panel.set_fun_balance(fun_balance)
	mode_panel.set_real_balance(real_balance)

	_current_mode = mode
	# `activeMode` is Shell-owned presentation state. On an iframe recreated
	# after Tonkeeper or a suspended Mini App it restores both the actual game
	# mode and the MODE panel toggle without emitting another player action.
	mode_panel.set_active_game_mode(_current_mode == "real")
	_sync_current_balance_from_mode()
	_stop_initial_balance_loading()
	_update_value_labels()
	_show_ready_marquee()


## Receives only validated bytes from Shell's same-origin API request. Godot
## deliberately has no external Telegram URL and makes no avatar HTTP request.
func _apply_shell_profile_avatar(payload: Variant) -> void:
	if not payload is Dictionary:
		return
	var content_type = payload.get("contentType")
	var data = payload.get("data")
	if not content_type is String or not data is String:
		return
	mode_panel.set_profile_avatar_base64(content_type, data)


## Любой 401 при инициализации означает, что текущий браузер больше не может
## продолжать гостевую игру. Модалка намеренно не пытается создать пользователя:
## это остаётся явным действием React entry page.
func _show_session_expired_alert() -> void:
	if _is_spin_in_progress or _is_revealing_result:
		_finish_spin_with_error()
	else:
		running_text.stop()
		win_counter.clear()
		win_flash.clear()
		show_authorization_required()

	buttons.set_bet_enabled(false)
	buttons.set_play_enabled(false)
	buttons.set_mode_enabled(false)
	session_expired_alert.show_alert()


func _on_session_expired_alert_dismissed() -> void:
	_play_from_start(click_sound)
	# Под модалкой остаётся недоступное состояние, а не прежний баланс.
	show_authorization_required()


func _on_session_expired_play_again_requested() -> void:
	_play_from_start(click_sound)
	WebBridge.post_to_shell({
		"type": "game:goHome",
		"payload": {},
	})


## Ответ на обновление балансов при открытии TON-панели. Если активен REAL,
## основной экран сразу пересчитывает доступные кредиты в выбранной шкале.
func _apply_shell_balances(payload: Variant) -> void:
	if not payload is Dictionary:
		return
	var balances = payload.get("balances")
	if not balances is Dictionary:
		return
	var fun_balance := _parse_balance(balances.get("fun"))
	var real_balance := _parse_balance(balances.get("real"))
	if fun_balance < 0 or real_balance < 0:
		return
	_fun_balance = fun_balance
	_real_balance_units = real_balance
	mode_panel.set_fun_balance(_fun_balance)
	mode_panel.set_real_balance(_real_balance_units)
	if _current_mode == "real":
		_sync_current_balance_from_mode()
		_update_value_labels()


func _apply_shell_wallet_state(payload: Variant) -> void:
	if not payload is Dictionary:
		return
	var connected = payload.get("connected")
	var wallet_balance = payload.get("walletBalance")
	if not connected is bool or not wallet_balance is String:
		return
	mode_panel.set_wallet_state(connected, wallet_balance)


## The Shell starts the wallet action only after it accepts the Godot intent.
## This prevents a local click from being mistaken for a verified connection.
func _apply_shell_wallet_action_state(payload: Variant) -> void:
	if not payload is Dictionary:
		return
	var action = payload.get("action")
	var pending = payload.get("pending")
	if (action != "connect" and action != "disconnect") or not pending is bool:
		return
	mode_panel.set_wallet_action_loading(pending)


func _apply_ton_connect_error(payload: Variant) -> void:
	if not payload is Dictionary:
		return
	var message = payload.get("message")
	if message is String:
		mode_panel.set_wallet_action_loading(false)
		mode_panel.show_ton_error(message)


func _apply_ton_operation_result(payload: Variant) -> void:
	if not payload is Dictionary:
		return
	var action = payload.get("action")
	var success = payload.get("success")
	var message = payload.get("message")
	if (action != "top_up" and action != "withdraw") or not success is bool or not message is String:
		return
	# A withdrawal hold returns its post-hold balance synchronously. Apply it
	# before activating either chain-processing spinner so the cached value is
	# ready when the terminal result restores the header.
	var balance = payload.get("balance")
	if balance is Dictionary and balance.get("mode") == "real":
		var real_balance := _parse_balance(balance.get("value"))
		if real_balance >= 0:
			_real_balance_units = real_balance
			mode_panel.set_real_balance(_real_balance_units)
			if _current_mode == "real":
				_sync_current_balance_from_mode()
				_update_value_labels()
	if payload.get("pending") == true:
		# Neither a TonConnect submission nor a server-side withdrawal hold is
		# final settlement. Keep the corresponding spinner until Shell reads a
		# durable terminal status from its chain worker.
		mode_panel.set_ton_action_enabled(action, false)
		mode_panel.start_real_balance_pending()
		if action == "top_up":
			mode_panel.show_topup_processing()
		else:
			mode_panel.show_withdraw_processing()
		return
	mode_panel.set_ton_action_enabled(action, true)
	if success:
		mode_panel.show_ton_success(message, action == "withdraw")
	else:
		mode_panel.show_ton_error(message)


func _apply_spin_result(payload: Variant) -> void:
	if not _is_spin_in_progress or _is_revealing_result or not payload is Dictionary:
		return
	# gameRequestId — не серверный идентификатор и не влияет на деньги. Он
	# связывает только UI-запрос с ответом Shell, чтобы поздний ответ после
	# тайм-аута не мог попасть в уже начатый следующий спин.
	if payload.get("gameRequestId") != _active_game_request_id:
		return

	var combination = payload.get("combination")
	var balance = payload.get("balance")
	if not combination is String or not balance is Dictionary:
		_finish_spin_with_error()
		return

	var digits := _parse_combination(combination)
	if balance.get("mode") != _current_mode:
		_finish_spin_with_error()
		return
	if _current_mode == "real" and payload.get("denomination") != REAL_DENOMINATION_VALUES[_selected_real_denomination]:
		# Ответ другой шкалы нельзя показывать как текущий баланс: это могло бы
		# визуально исказить сумму даже при корректных данных сервера.
		_finish_spin_with_error()
		return

	var new_balance := _parse_balance(balance.get("value"))
	if digits.is_empty() or new_balance < 0:
		_finish_spin_with_error()
		return

	var multiplier = payload.get("multiplier", 0)
	var payout := _parse_balance(payload.get("payout", "0"))
	_result_digits = digits
	if _current_mode == "real":
		# REAL balance in the API is canonical TON units. The game only displays
		# the spendable credits for the denomination locked at PLAY time.
		_real_balance_units = new_balance
		_result_balance = _real_units_to_credits(new_balance)
		mode_panel.set_real_balance(new_balance)
	else:
		_fun_balance = new_balance
		_result_balance = new_balance
		mode_panel.set_fun_balance(new_balance)
	_pending_result_multiplier = _parse_nonnegative_integer(multiplier)
	_pending_result_payout = payout if payout >= 0 else 0
	# Правило приходит от сервера вместе с выплатой. Его нельзя выводить из
	# комбинации в игре: у шаблонов есть пересечения (777 также подходит под 7XX).
	_pending_result_rule = payload.get("rule", "") if payload.get("rule") is String else ""
	_cancel_spin_response_wait()
	_stop_pre_spinning()
	# Теперь результат уже получен: PLAY можно снова использовать для skip
	# визуального вращения, как и до добавления сетевого ожидания.
	buttons.set_play_enabled(true)
	_is_revealing_result = true
	if _skip_reveal_after_response:
		_show_result_on_reels()
		_finish_revealing_result()
		return

	_reveal_sequence_id += 1
	var reveal_sequence_id := _reveal_sequence_id
	var reveal_completed := await _reveal_reels(digits, reveal_sequence_id)
	if not reveal_completed:
		return
	_finish_revealing_result()


func _apply_spin_error(payload: Variant) -> void:
	if not _is_spin_in_progress:
		return
	if not payload is Dictionary or payload.get("gameRequestId") != _active_game_request_id:
		return

	var error_code := "unknown"
	if payload is Dictionary and payload.get("code") is String:
		error_code = payload.get("code")

	if error_code == "insufficient_fun_balance" or error_code == "insufficient_real_balance":
		show_insufficient_balance()
	elif error_code == "request_failed":
		show_connection_error()
	else:
		show_authorization_error()
	_finish_spin_with_error()


func _parse_balance(value: Variant) -> int:
	# Public API передаёт BIGINT как строку. Число допускаем только для локальной
	# отладки, но не используем его как источник истины в production-контракте.
	if value is String and value.is_valid_int():
		return value.to_int()
	if value is int:
		return value
	return -1


func _parse_nonnegative_integer(value: Variant) -> int:
	# JSON.parse_string может представить server-side multiplier как float,
	# даже если JSON содержит целое значение (например, 1). Принимаем только
	# значения без дробной части, чтобы 1.5 никогда не стало выигрышем ×1.
	if value is int:
		return value if value >= 0 else 0
	if value is float and is_equal_approx(value, floor(value)):
		return int(value) if value >= 0 else 0
	return 0


func _update_value_labels() -> void:
	bet_value_label.text = str(current_bet)
	if not _is_initial_balance_loading:
		balance_value_label.text = str(current_balance)


## В начале Web/Mini App загрузки Shell ещё не знает сессию и баланс. Это
## исключительно индикатор ожидания: после shell:session он выключается,
## а на экран попадает только серверное значение current_balance.
func _start_initial_balance_loading() -> void:
	if _is_initial_balance_loading:
		return

	_is_initial_balance_loading = true
	_initial_balance_loading_frame = 0
	_update_initial_balance_loading_label()
	_initial_balance_loading_tween = create_tween().set_loops()
	_initial_balance_loading_tween.tween_interval(INITIAL_BALANCE_LOADING_STEP_SECONDS)
	_initial_balance_loading_tween.tween_callback(_advance_initial_balance_loading)


func _advance_initial_balance_loading() -> void:
	_initial_balance_loading_frame = (_initial_balance_loading_frame + 1) % INITIAL_BALANCE_LOADING_FRAMES.size()
	_update_initial_balance_loading_label()


func _update_initial_balance_loading_label() -> void:
	if _is_initial_balance_loading:
		balance_value_label.text = INITIAL_BALANCE_LOADING_FRAMES[_initial_balance_loading_frame]


func _stop_initial_balance_loading() -> void:
	_is_initial_balance_loading = false
	if _initial_balance_loading_tween != null and _initial_balance_loading_tween.is_valid():
		_initial_balance_loading_tween.kill()


## В REAL UI работает с кредитами, но сервер и БД — только с целыми TON units.
## Отсекаем остаток, который нельзя поставить минимальной ставкой 10 кредитов.
func _real_units_to_credits(real_units: int) -> int:
	if real_units < 0:
		return 0
	var divisor := REAL_DENOMINATION_DIVISORS[_selected_real_denomination]
	var credits := real_units / divisor
	return (credits / MINIMUM_BET_CREDITS) * MINIMUM_BET_CREDITS


func _sync_current_balance_from_mode() -> void:
	current_balance = _fun_balance if _current_mode == "fun" else _real_units_to_credits(_real_balance_units)


func _on_play_requested() -> void:
	# Универсальный UI-отклик: воспроизводится и при запуске, и при пропуске
	# текущей визуальной анимации спина.
	_play_from_start(click_sound)
	if _is_spin_in_progress:
		_skip_current_spin_visuals()
		return

	# Проигрыш не требует промежуточной готовности: PLAY поверх LOSS или
	# TRY AGAIN сразу запускает следующий серверный спин ниже.
	if _marquee_status == MarqueeStatus.LOSS or _marquee_status == MarqueeStatus.TRY_AGAIN:
		win_flash.clear()
	# После выигрыша оставляем отдельный шаг готовности, чтобы игрок успел
	# увидеть результат и подчёркнутую строку таблицы выплат.
	elif _marquee_status == MarqueeStatus.WIN:
		_complete_win_presentation_immediately()
		win_flash.clear()
		_show_ready_marquee()
		return
	if current_bet > current_balance:
		show_insufficient_balance()
		return

	_is_spin_in_progress = true
	# Новый спин не должен доигрывать звук предыдущего крупного выигрыша.
	_stop_big_win_sounds()
	_win_sound_started_for_result = false
	_balance_before_spin = current_balance
	current_balance -= current_bet
	_update_value_labels()
	_skip_reveal_after_response = false
	_result_digits.clear()
	_win_presentation_id += 1
	win_counter.clear()
	buttons.set_bet_enabled(false)
	# Пока Shell ждёт API, второй PLAY не создаёт второй серверный запрос и не
	# пропускает pre_spinning. После результата кнопка снова станет skip-кнопкой.
	buttons.set_play_enabled(false)
	buttons.set_mode_enabled(false)
	show_spinning()
	_start_pre_spinning()
	win_flash.clear()

	# Shell создаёт requestId, запрашивает API и вернёт только серверный
	# combination. Клиент никогда не выбирает цифры сам.
	_spin_request_serial += 1
	_active_game_request_id = "spin-%d" % _spin_request_serial
	_start_spin_response_timeout(_active_game_request_id)
	var spin_payload := {
		"gameRequestId": _active_game_request_id,
		"bet": current_bet,
		"mode": _current_mode,
	}
	if _current_mode == "real":
		# Denomination is supplied for explicit server validation; it is never
		# inferred from a formatted UI string.
		spin_payload["denomination"] = REAL_DENOMINATION_VALUES[_selected_real_denomination]
	WebBridge.post_to_shell({"type": "game:spinRequested", "payload": spin_payload})


## Один кадр pre_spinning поочерёдно показывается в трёх позициях, создавая
## короткий бегущий индикатор слева направо, пока API выбирает результат.
func _start_pre_spinning() -> void:
	_stop_pre_spinning()
	_pre_spinning_reel_index = 0
	_show_pre_spinning_reel()
	_pre_spinning_tween = create_tween().set_loops()
	_pre_spinning_tween.tween_interval(PRE_SPINNING_STEP_SECONDS)
	_pre_spinning_tween.tween_callback(_advance_pre_spinning)


func _advance_pre_spinning() -> void:
	_pre_spinning_reel_index = (_pre_spinning_reel_index + 1) % reels.size()
	_show_pre_spinning_reel()


func _show_pre_spinning_reel() -> void:
	for reel_index in reels.size():
		var reel := reels[reel_index]
		reel.visible = reel_index == _pre_spinning_reel_index
		if reel.visible:
			reel.play(&"pre_spinning")


func _stop_pre_spinning() -> void:
	if _pre_spinning_tween != null and _pre_spinning_tween.is_valid():
		_pre_spinning_tween.kill()
	for reel in reels:
		reel.hide()


func _start_spin_response_timeout(game_request_id: String) -> void:
	_spin_response_timeout = get_tree().create_timer(SPIN_RESPONSE_TIMEOUT_SECONDS)
	_spin_response_timeout.timeout.connect(_on_spin_response_timeout.bind(game_request_id))


func _cancel_spin_response_wait() -> void:
	_active_game_request_id = ""
	_spin_response_timeout = null
	_spin_reconciliation_timeout = null
	_is_waiting_for_spin_reconciliation = false


func _on_spin_response_timeout(game_request_id: String) -> void:
	if not _is_spin_in_progress or _is_revealing_result or game_request_id != _active_game_request_id:
		return

	# Серверный POST мог успешно закоммититься, а HTTP-ответ потеряться. Поэтому
	# на UX-пороге не восстанавливаем локальный баланс и не очищаем request ID:
	# Shell уже ищет сохранённый спин по тому же server requestId. Поздний,
	# подтверждённый результат всё ещё должен попасть в этот раунд.
	_is_waiting_for_spin_reconciliation = true
	show_connection_error()
	_spin_reconciliation_timeout = get_tree().create_timer(SPIN_RECONCILIATION_GRACE_SECONDS)
	_spin_reconciliation_timeout.timeout.connect(_on_spin_reconciliation_timeout.bind(game_request_id))


func _on_spin_reconciliation_timeout(game_request_id: String) -> void:
	if not _is_spin_in_progress or _is_revealing_result or game_request_id != _active_game_request_id:
		return

	# Нет ни terminal-ответа Shell, ни восстановленного результата. Только здесь
	# допустимо отпустить UI и отменить локальную визуальную проекцию ставки.
	show_connection_error()
	_finish_spin_with_error()


func _parse_combination(combination: String) -> Array[int]:
	if combination.length() != reels.size():
		return []

	var digits: Array[int] = []
	for index in combination.length():
		var digit_text := combination.substr(index, 1)
		if not digit_text.is_valid_int():
			return []
		var digit := digit_text.to_int()
		if digit < 0 or digit > 9:
			return []
		digits.append(digit)
	return digits


## Останавливает барабаны строго слева направо. Каждый совершает два полных
## loop анимации play_spinning, затем замораживается на кадре numbers, где
## номер кадра совпадает с серверной цифрой: 0 -> кадр 0, …, 9 -> кадр 9.
func _reveal_reels(digits: Array[int], reveal_sequence_id: int) -> bool:
	for reel_index in reels.size():
		var reel := reels[reel_index]
		reel.show()
		reel.play(&"play_spinning")
		# spinning.wav длится ~1.09 сек и полностью покрывает два лупа
		# play_spinning (~0.8 сек) одного барабана.
		_play_from_start(reel_spin_sound)
		for loop_number in REEL_SPIN_LOOPS:
			await reel.animation_looped
			if reveal_sequence_id != _reveal_sequence_id:
				return false

		reel.animation = &"numbers"
		reel.frame = digits[reel_index]
		reel.pause()
		reel_spin_sound.stop()
		if reel_index == reels.size() - 1:
			# Стартует сразу с фиксацией последней цифры, до технической паузы
			# REEL_STOP_DELAY_SECONDS и до появления WinFlash.
			_start_win_sound_if_needed()
		await get_tree().create_timer(REEL_STOP_DELAY_SECONDS).timeout
		if reveal_sequence_id != _reveal_sequence_id:
			return false
	return true


## PLAY во время SPINNING... не создаёт повторный спин. Если ответ сервера
## уже получен — немедленно раскрываем цифры; иначе сделаем это в момент ответа.
func _skip_current_spin_visuals() -> void:
	if not _is_revealing_result:
		_skip_reveal_after_response = true
		return

	_reveal_sequence_id += 1
	_show_result_on_reels()
	_finish_revealing_result()


func _show_result_on_reels() -> void:
	# PLAY пропускает вращение и сразу фиксирует все цифры.
	reel_spin_sound.stop()
	for reel_index in reels.size():
		var reel := reels[reel_index]
		reel.show()
		reel.animation = &"numbers"
		reel.frame = _result_digits[reel_index]
		reel.pause()
	_start_win_sound_if_needed()


## Оформляет уже полученный серверный результат. LOSS/WIN заменяет
## SPINNING... прямо в центре, без промежуточного ухода строки.
func _finish_revealing_result() -> void:
	_is_spin_in_progress = false
	_is_revealing_result = false
	# Ставка снова доступна сразу после остановки барабанов. Если пользователь
	# нажмёт BET во время LOSS/WIN, _on_bet_requested сменит строку на новый BET.
	buttons.set_bet_enabled(true)
	# Проигрыш не имеет отдельной критичной подачи: после остановки барабанов
	# MODE можно открыть сразу, даже пока RunningText показывает LOSS/TRY AGAIN.
	# Выигрыш остаётся заблокированным до WinFlash и начисления баланса.
	if _pending_result_multiplier <= 0:
		buttons.set_mode_enabled(true)

	_show_pending_spin_outcome()


func _finish_spin_with_error() -> void:
	_stop_big_win_sounds()
	reel_spin_sound.stop()
	_stop_pre_spinning()
	_cancel_spin_response_wait()
	_win_sound_started_for_result = false
	for reel in reels:
		reel.show()
		reel.play(&"def_spinning")
	current_balance = _balance_before_spin
	_update_value_labels()
	_is_spin_in_progress = false
	_is_revealing_result = false
	_pending_result_multiplier = 0
	_pending_result_payout = 0
	_pending_result_rule = ""
	_result_digits.clear()
	_skip_reveal_after_response = false
	_win_presentation_id += 1
	win_counter.clear()
	win_flash.clear()
	buttons.set_bet_enabled(true)
	buttons.set_play_enabled(true)
	# Ошибка завершила активный раунд: Mode нужен, например, чтобы открыть FUN top-up.
	buttons.set_mode_enabled(true)


func _on_mode_requested() -> void:
	_play_from_start(click_sound)
	# Панель всегда показывает FUN-баланс отдельно: в TON current_balance уже
	# является количеством реальных кредитов, а не FUN-счётом.
	mode_panel.set_fun_balance(_fun_balance)
	mode_panel.open()
	WebBridge.post_to_shell({
		"type": "game:modeRequested",
		"payload": {"currentMode": _current_mode},
	})


func _on_mode_panel_close_pressed() -> void:
	_play_from_start(click_sound)


## Godot сообщает только визуальное состояние. React Shell решает, каким
## фоном заполнить области за пределами фиксированного портретного холста.
func _on_mode_panel_open_state_changed(is_open: bool) -> void:
	WebBridge.post_to_shell({
		"type": "game:modePanelStateChanged",
		"payload": {"isOpen": is_open},
	})


## Заблокированный TON-переход тоже получает привычный click.wav, но не меняет
## _current_mode и не инициирует запрос REAL-баланса.
func _on_ton_connect_alert_opened() -> void:
	_play_from_start(click_sound)


func _on_ton_ui_clicked() -> void:
	_play_from_start(click_sound)


func _on_mode_panel_view_toggled(is_ton_view: bool) -> void:
	_play_from_start(click_sound)
	if is_ton_view and _real_mode_available:
		_current_mode = "real"
		_sync_current_balance_from_mode()
		_update_value_labels()
		_show_ready_marquee()
		WebBridge.post_to_shell({
			"type": "game:realBalanceRequested",
			"payload": {},
		})
	else:
		# The Telegram player may browse the TON panel and link a wallet, but
		# cannot accidentally send a REAL PLAY until API has confirmed the
		# binding in a later shell:session refresh.
		_current_mode = "fun"
		_sync_current_balance_from_mode()
		_update_value_labels()
		_show_ready_marquee()

	# Shell stores only this non-authoritative UI preference in sessionStorage.
	# That prevents `GET /me/session` (whose safe server default is FUN) from
	# visually resetting a restored Telegram Mini App back to FUN mode.
	WebBridge.post_to_shell({
		"type": "game:modeRequested",
		"payload": {"currentMode": _current_mode},
	})


## Alert не знает, открыт ли проект в браузере или внутри Telegram. Shell
## выберет безопасный маршрут: deep link для браузера, TonConnect для Mini App.
func _on_ton_connect_requested() -> void:
	_play_from_start(click_sound)
	WebBridge.post_to_shell({
		"type": "game:tonConnectRequested",
		"payload": {},
	})


## Отключение — это только разрыв локального TonConnect-соединения в Shell.
## Серверная запись proof остаётся отдельной задачей и не зависит от этой кнопки.
func _on_ton_disconnect_requested() -> void:
	_play_from_start(click_sound)
	WebBridge.post_to_shell({
		"type": "game:tonDisconnectRequested",
		"payload": {},
	})


## Godot передаёт строку, а не float. Shell/API позже повторят строгий разбор
## в bigint/nanotons перед созданием invoice; этому клиентскому значению нельзя
## доверять для начисления баланса.
func _on_ton_top_up_requested(amount: String) -> void:
	_play_from_start(click_sound)
	mode_panel.set_ton_action_enabled("top_up", false)
	WebBridge.post_to_shell({
		"type": "game:tonTopUpRequested",
		"payload": {"amount": amount},
	})


func _on_ton_withdraw_requested(amount: String) -> void:
	_play_from_start(click_sound)
	mode_panel.set_ton_action_enabled("withdraw", false)
	WebBridge.post_to_shell({
		"type": "game:tonWithdrawRequested",
		"payload": {"amount": amount},
	})


func _on_denomination_selected(index: int, api_value: String) -> void:
	_play_from_start(click_sound)
	if index < 0 or index >= REAL_DENOMINATION_DIVISORS.size():
		return
	# api_value is checked defensively even though it originated inside ModePanel.
	if api_value != REAL_DENOMINATION_VALUES[index]:
		return
	_selected_real_denomination = index
	if _current_mode == "real":
		_sync_current_balance_from_mode()
		_update_value_labels()
		_show_ready_marquee()


func _on_fun_credits_requested() -> void:
	_play_from_start(click_sound)
	WebBridge.post_to_shell({
		"type": "game:funCreditsRequested",
		"payload": {},
	})


## A withdrawal stays inside the Mini App, so its success cue is safe to play
## immediately. A deposit may return from Tonkeeper with iOS Web Audio paused,
## therefore it intentionally has no queued success sound.
func _on_ton_withdrawal_confirmed() -> void:
	_play_from_start(credits_granted_sound)


func _apply_fun_credits_result(payload: Variant) -> void:
	mode_panel.set_fun_credit_action_enabled(true)
	if not payload is Dictionary:
		mode_panel.show_fun_credit_error()
		return

	var balance = payload.get("balance")
	if not balance is Dictionary or balance.get("mode") != "fun":
		mode_panel.show_fun_credit_error()
		return

	var updated_balance := _parse_balance(balance.get("value"))
	if updated_balance < 0:
		mode_panel.show_fun_credit_error()
		return

	# Только API сообщает новое значение. Godot не прибавляет 1000 сам.
	_fun_balance = updated_balance
	if _current_mode == "fun":
		current_balance = updated_balance
		_update_value_labels()
	mode_panel.set_fun_balance(updated_balance)
	# Звук подтверждает только успешное начисление, подтверждённое API.
	_play_from_start(credits_granted_sound)
	mode_panel.show_fun_credit_success()


func _apply_fun_credits_error(payload: Variant) -> void:
	mode_panel.set_fun_credit_action_enabled(true)
	var error_message := "CONNECTION ERROR. TRY AGAIN"
	# Rejections such as "balance is already >= 100" include the authoritative
	# server balance. Do not leave a stale value on the panel just because the
	# attempted command itself was rejected.
	if payload is Dictionary:
		if payload.get("code") == "fun_credit_balance_too_high":
			error_message = "BALANCE MUST BE UNDER 100 FUN"
		var balance = payload.get("balance")
		if balance is Dictionary and balance.get("mode") == "fun":
			var updated_balance := _parse_balance(balance.get("value"))
			if updated_balance >= 0:
				_fun_balance = updated_balance
				if _current_mode == "fun":
					current_balance = updated_balance
					_update_value_labels()
				mode_panel.set_fun_balance(updated_balance)
	mode_panel.show_fun_credit_error(error_message)

## Главная точка входа для игрового кода: она выбирает текст, повтор и профиль.
func show_marquee_status(status: int, multiplier := 0, payout := 0) -> void:
	_marquee_status = status

	if status == MarqueeStatus.FUN_READY or status == MarqueeStatus.REAL_READY:
		_ready_message_index = 0
		_play_next_ready_message()
		return

	running_text.show_message(
		_get_status_message(status, multiplier, payout),
		_is_persistent_status(status),
		_get_behavior_profile(status),
	)

# Публичные методы вызываются будущей логикой игры или shell bridge.
func show_authorization_required() -> void:
	# Ожидание завершено и без действующей сессии: возвращаем обычное значение
	# (0 из исходной сцены), а не оставляем индикатор загрузки навсегда.
	_stop_initial_balance_loading()
	_update_value_labels()
	show_marquee_status(MarqueeStatus.AUTH_REQUIRED)

func show_authorization_error() -> void:
	_stop_initial_balance_loading()
	_update_value_labels()
	show_marquee_status(MarqueeStatus.AUTH_ERROR)

func show_connection_error() -> void:
	show_marquee_status(MarqueeStatus.AUTH_ERROR)

func show_insufficient_balance() -> void:
	show_marquee_status(MarqueeStatus.INSUFFICIENT_BALANCE)

func show_spinning() -> void:
	show_marquee_status(MarqueeStatus.SPINNING)

func show_loss() -> void:
	show_marquee_status(MarqueeStatus.LOSS)

func _on_running_text_message_finished() -> void:
	# FUN_READY прокручивает playlist; LOSS и TRY AGAIN после показа возвращают
	# игрока к обычному циклу. WIN управляет отдельный WinCounter.
	if _marquee_status == MarqueeStatus.FUN_READY or _marquee_status == MarqueeStatus.REAL_READY:
		_ready_message_index = (_ready_message_index + 1) % _get_ready_messages().size()
		_play_next_ready_message()
		return

	if _marquee_status == MarqueeStatus.LOSS:
		show_marquee_status(MarqueeStatus.TRY_AGAIN)
		return

	if _marquee_status == MarqueeStatus.TRY_AGAIN:
		_show_ready_marquee()


func _show_pending_spin_outcome() -> void:
	if _pending_result_multiplier > 0:
		_start_win_presentation(_pending_result_payout, _pending_result_rule)
	else:
		# При проигрыше итоговый серверный баланс равен балансу после ставки.
		current_balance = _result_balance
		_update_value_labels()
		show_loss()
	_pending_result_multiplier = 0
	_pending_result_payout = 0
	_pending_result_rule = ""


## Последовательность победы: текст и таблица выплат одновременно -> счёт BAL.
## Все денежные значения уже подтверждены API; здесь только визуальная подача.
func _start_win_presentation(payout: int, rule: String) -> void:
	_win_presentation_id += 1
	var presentation_id := _win_presentation_id
	_marquee_status = MarqueeStatus.WIN
	running_text.stop()
	win_counter.show_win(payout)
	var is_major_win := rule not in SMALL_WIN_RULES
	# Обычно звук уже пошёл при остановке третьего барабана. Этот вызов —
	# безопасная страховка для нетипичного пути показа результата.
	_start_win_sound_if_needed()
	# WinCounter и WinFlash начинаются в один кадр. Малый и крупный выигрыши
	# используют разные профили WinFlash; у крупного финальная подсветка дольше.
	if is_major_win:
		await win_flash.flash_major_rule(rule)
	else:
		await win_flash.flash_small_rule(rule)
	if presentation_id != _win_presentation_id:
		return
	if is_major_win:
		# big_cashout.wav (~3.57 с) сопровождает трёхсекундный счётчик BAL.
		_play_from_start(big_cashout_sound)
	else:
		# small_cashout.wav стартует вместе с односекундным начислением.
		_play_from_start(small_cashout_sound)
	await win_counter.animate_credit(
		balance_value_label,
		current_balance,
		_result_balance,
		payout,
		_get_credit_duration(rule),
	)
	if presentation_id != _win_presentation_id:
		return
	_show_default_logo()
	current_balance = _result_balance
	_update_value_labels()
	_show_ready_marquee()


## PLAY может пропустить победную подачу, но финальный баланс всё равно
## немедленно берётся из ответа API, а не вычисляется на клиенте.
func _complete_win_presentation_immediately() -> void:
	_win_presentation_id += 1
	_stop_big_win_sounds()
	win_counter.clear()
	current_balance = _result_balance
	_update_value_labels()


func _get_credit_duration(rule: String) -> float:
	return win_counter.small_win_credit_duration if rule in SMALL_WIN_RULES else win_counter.major_win_credit_duration


func _play_from_start(player: AudioStreamPlayer) -> void:
	player.stop()
	player.play()


func _play_bet_change_sound() -> void:
	match current_bet:
		10:
			_play_from_start(bet_10_sound)
		100:
			_play_from_start(bet_100_sound)
		1000:
			_play_from_start(bet_1000_sound)


func _start_win_sound_if_needed() -> void:
	if _pending_result_multiplier <= 0 or _win_sound_started_for_result:
		return
	_win_sound_started_for_result = true
	# Младшие правила имеют отдельный короткий акцент. Для остальных правил
	# сохраняем основной big_win.wav. Правило приходит с сервера, не вычисляется UI.
	if _pending_result_rule in SMALL_WIN_RULES:
		_play_from_start(small_win_sound)
	else:
		_play_from_start(big_win_sound)
	# Единая зацикленная анимация начинается с выпадением выигрыша и идёт до
	# окончания начисления, вне зависимости от того, малый он или крупный.
	_start_logo_win_animation()


func _stop_big_win_sounds() -> void:
	big_win_sound.stop()
	small_win_sound.stop()
	big_cashout_sound.stop()
	small_cashout_sound.stop()
	_show_default_logo()


## Запускает зацикленную победную анимацию с первого кадра.
func _start_logo_win_animation() -> void:
	logo.animation = &"win_animation"
	logo.frame = 0
	logo.frame_progress = 0.0
	logo.play()


## Обычное состояние: логотип непрерывно проигрывает default_animation.
func _show_default_logo() -> void:
	logo.animation = &"default_animation"
	logo.frame = 0
	logo.frame_progress = 0.0
	logo.play()

func _play_next_ready_message() -> void:
	var message_template: String = _get_ready_messages()[_ready_message_index]
	var message := message_template
	if "%d" in message_template:
		message = message_template % current_bet

	running_text.show_message(message, false, _get_ready_message_profile())

func _get_ready_message_profile() -> int:
	# Название режима — главный акцент, поэтому использует мигание. Ставка и
	# подсказка прокручиваются без него, чтобы не отвлекать от значения.
	if _ready_message_index == 1:
		return RunningText.BehaviorProfile.REAL_READY if _current_mode == "real" else RunningText.BehaviorProfile.FUN_READY

	return RunningText.BehaviorProfile.FUN_READY_PLAIN


func _get_ready_messages() -> Array:
	return REAL_READY_MESSAGES if _current_mode == "real" else FUN_READY_MESSAGES


func _show_ready_marquee() -> void:
	# MODE доступен только когда нет прокрутки барабанов, LOSS/WIN-анимации или
	# начисления баланса. Состояние READY — единственная безопасная точка входа.
	buttons.set_mode_enabled(true)
	show_marquee_status(MarqueeStatus.REAL_READY if _current_mode == "real" else MarqueeStatus.FUN_READY)

func _is_persistent_status(status: int) -> bool:
	# Такие состояния нельзя завершать автоматически: их сменит только игра.
	return status == MarqueeStatus.AUTH_REQUIRED \
		or status == MarqueeStatus.AUTH_ERROR \
		or status == MarqueeStatus.INSUFFICIENT_BALANCE \
		or status == MarqueeStatus.SPINNING

func _get_behavior_profile(status: int) -> int:
	match status:
		MarqueeStatus.AUTH_REQUIRED, MarqueeStatus.AUTH_ERROR, MarqueeStatus.INSUFFICIENT_BALANCE:
			return RunningText.BehaviorProfile.ALERT
		MarqueeStatus.SPINNING:
			return RunningText.BehaviorProfile.SPINNING
		MarqueeStatus.LOSS, MarqueeStatus.TRY_AGAIN:
			return RunningText.BehaviorProfile.LOSS
		MarqueeStatus.WIN:
			return RunningText.BehaviorProfile.WIN
		_:
			return RunningText.BehaviorProfile.FUN_READY

func _get_status_message(status: int, multiplier: int, payout: int) -> String:
	match status:
		MarqueeStatus.AUTH_REQUIRED:
			return "AUTHORIZE TO PLAY"
		MarqueeStatus.AUTH_ERROR:
			return "CONNECTION ERROR"
		MarqueeStatus.INSUFFICIENT_BALANCE:
			return "INSUFFICIENT BALANCE"
		MarqueeStatus.SPINNING:
			return "SPINNING"
		MarqueeStatus.LOSS:
			return "LOSS"
		MarqueeStatus.TRY_AGAIN:
			return "TRY AGAIN"
		MarqueeStatus.WIN:
			return "WON %d!" % payout
		_:
			return ""
