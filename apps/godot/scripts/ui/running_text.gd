class_name RunningText
extends Control

## Отправляется только для одноразового сообщения после его полного показа.
## Контроллер игры использует сигнал, чтобы включить следующую строку playlist.
signal message_finished

## Профили описывают визуальное поведение, а не игровую логику.
## Для нового типа сообщения обычно достаточно добавить профиль сюда и назначить
## его соответствующему статусу в slots.gd.
enum BehaviorProfile {
	FUN_READY,
	REAL_READY,
	FUN_READY_PLAIN,
	ALERT,
	SPINNING,
	LOSS,
	WIN,
}

enum PlaybackMode {
	SEQUENCE,
	STATIC_ALERT,
	STATIC_CENTER,
}

enum ScrollState {
	ENTERING,
	INITIAL_HOLD,
	BLINKING,
	FINAL_HOLD,
	LEAVING,
}

# Скорость всех профилей, которые используют базовую прокрутку FUN_READY.
@export_range(20.0, 3_200.0, 1.0, "suffix:px/s") var scroll_speed := 760.0
# Сколько секунд текст виден в центре перед серией миганий.
@export_range(0.1, 10.0, 0.1, "suffix:s") var initial_center_hold_duration := 0.3
# Общая длительность всей серии миганий, а не одного исчезновения.
@export_range(0.1, 10.0, 0.1, "suffix:s") var center_pause_duration := 1.5
# Количество полных миганий: каждое состоит из видимой и скрытой части.
@export_range(1, 10, 1) var blink_count := 3
# Доля одного мигания, в течение которой текст скрыт.
# Уменьшайте значение, чтобы исчезновение было короче: 0.20 = 20% скрыт,
# 0.50 = половину времени скрыт, 0.80 = почти всё время скрыт.
@export_range(0.05, 0.95, 0.05) var blink_hidden_ratio := 0.20
# Сколько секунд текст виден в центре после серии миганий.
@export_range(0.1, 10.0, 0.1, "suffix:s") var final_center_hold_duration := 1.0
# Эти два параметра относятся только к постоянному профилю ALERT.
# Уменьшайте Alert Hidden Duration, если предупреждение исчезает слишком надолго.
@export_range(0.05, 5.0, 0.05, "suffix:s") var alert_visible_duration := 0.35
@export_range(0.05, 5.0, 0.05, "suffix:s") var alert_hidden_duration := 0.18

@onready var text_label: Label = $Text

var _text_y := 0.0
var _pause_elapsed := 0.0
var _state := ScrollState.ENTERING
var _playback_mode := PlaybackMode.SEQUENCE
var _is_playing := true
var _repeat_current_message := true

# Активные значения берутся из выбранного профиля, не меняя экспортируемые
# настройки обычного FUN_READY-сценария в Inspector.
var _active_scroll_speed := 0.0
var _active_initial_hold_duration := 0.0
var _active_blink_duration := 0.0
var _active_blink_count := 0
var _active_blink_hidden_ratio := 0.0
var _active_final_hold_duration := 0.0
# Профили результата могут появляться без пробега справа.
var _start_in_center := false

func _ready() -> void:
	_text_y = text_label.position.y
	# Не проигрываем шаблонный текст из сцены при старте. Первое сообщение
	# обязан явно задать Slots после получения состояния Shell.
	_is_playing = false
	text_label.visible = false
	resized.connect(_on_resized)
	_configure_profile(BehaviorProfile.FUN_READY)


func _on_resized() -> void:
	# Изменение размера не должно случайно показать placeholder до show_message().
	if _is_playing:
		_restart_current_message()

func _process(delta: float) -> void:
	if not _is_playing:
		return

	if _playback_mode == PlaybackMode.STATIC_ALERT:
		_update_static_alert(delta)
		return
	if _playback_mode == PlaybackMode.STATIC_CENTER:
		return

	match _state:
		ScrollState.ENTERING:
			_move_to_center(delta)
		ScrollState.INITIAL_HOLD:
			_hold_before_blink(delta)
		ScrollState.BLINKING:
			_blink_at_center(delta)
		ScrollState.FINAL_HOLD:
			_hold_at_center(delta)
		ScrollState.LEAVING:
			_move_out(delta)

## Запускает текст с нужным визуальным профилем.
## repeat=true оставляет сообщение в бесконечном цикле, false отправляет
## message_finished после полного прохода.
func show_message(message: String, repeat: bool = true, profile: int = BehaviorProfile.FUN_READY) -> void:
	text_label.text = message
	# Ширина зависит от текста: иначе длинные сообщения обрежутся до размера
	# исходного "FUN MODE" и не смогут корректно центрироваться.
	text_label.size.x = text_label.get_minimum_size().x
	_repeat_current_message = repeat
	_is_playing = true
	_configure_profile(profile)
	_restart_current_message()

func stop() -> void:
	_is_playing = false
	text_label.visible = false


## Завершает постоянное сообщение SPINNING... обычным уходом влево. После
## полного ухода отправляется message_finished, поэтому следующий текст не
## накладывается на него в центре.
func leave_center_message() -> void:
	if _playback_mode != PlaybackMode.STATIC_CENTER:
		return

	_repeat_current_message = false
	_is_playing = true
	text_label.visible = true
	_state = ScrollState.LEAVING
	_playback_mode = PlaybackMode.SEQUENCE

func _configure_profile(profile: int) -> void:
	# FUN_READY использует значения из Inspector; остальные профили имеют
	# осмысленные фиксированные настройки и не влияют на дефолтный сценарий.
	_playback_mode = PlaybackMode.SEQUENCE
	_active_scroll_speed = scroll_speed
	_active_initial_hold_duration = initial_center_hold_duration
	_active_blink_duration = center_pause_duration
	_active_blink_count = blink_count
	_active_blink_hidden_ratio = blink_hidden_ratio
	_active_final_hold_duration = final_center_hold_duration
	_start_in_center = false

	match profile:
		BehaviorProfile.FUN_READY_PLAIN:
			# Ставка и подсказка должны читаться спокойно, без вспышек.
			_active_blink_count = 0
		BehaviorProfile.REAL_READY:
			# REAL MODE использует те же паузы и мигания, что и FUN MODE, но
			# остаётся отдельным профилем для будущей настройки без побочных
			# изменений FUN-режима.
			pass
		BehaviorProfile.ALERT:
			# Авторизация и недостаток баланса: остаёмся в центре и мигаем,
			# пока GameController не сменит статус.
			_playback_mode = PlaybackMode.STATIC_ALERT
		BehaviorProfile.SPINNING:
			# SPINNING... неподвижно стоит в центре до сообщения результата.
			_playback_mode = PlaybackMode.STATIC_CENTER
		BehaviorProfile.LOSS:
			# LOSS и TRY AGAIN: ровно одна секунда в центре, без миганий.
			_active_initial_hold_duration = 0.0
			_active_blink_count = 0
			_active_final_hold_duration = 1.0
		BehaviorProfile.WIN:
			# Результат победы должен быть виден сразу после остановки барабанов:
			# ставим WON в центр без въезда справа, держим две секунды и уводим.
			_start_in_center = true
			_active_initial_hold_duration = 0.0
			_active_blink_count = 0
			_active_final_hold_duration = 2.0

func _restart_current_message() -> void:
	_pause_elapsed = 0.0
	text_label.visible = true

	if _playback_mode == PlaybackMode.STATIC_ALERT:
		text_label.position = Vector2(_get_center_x(), _text_y)
		return
	if _playback_mode == PlaybackMode.STATIC_CENTER:
		text_label.position = Vector2(_get_center_x(), _text_y)
		return
	if _start_in_center:
		text_label.position = Vector2(_get_center_x(), _text_y)
		_state = ScrollState.INITIAL_HOLD
		return

	text_label.position = Vector2(size.x, _text_y)
	_state = ScrollState.ENTERING

func _move_to_center(delta: float) -> void:
	text_label.position.x = move_toward(text_label.position.x, _get_center_x(), _active_scroll_speed * delta)

	if is_equal_approx(text_label.position.x, _get_center_x()):
		_pause_elapsed = 0.0
		_state = ScrollState.INITIAL_HOLD

func _hold_before_blink(delta: float) -> void:
	_pause_elapsed += delta

	if _pause_elapsed >= _active_initial_hold_duration:
		_pause_elapsed = 0.0
		_state = ScrollState.FINAL_HOLD if _active_blink_count == 0 else ScrollState.BLINKING

func _blink_at_center(delta: float) -> void:
	_pause_elapsed += delta
	var blink_cycle_duration := _active_blink_duration / float(_active_blink_count)
	var cycle_elapsed := fmod(_pause_elapsed, blink_cycle_duration)
	var visible_duration := blink_cycle_duration * (1.0 - _active_blink_hidden_ratio)
	# Сначала текст виден, затем исчезает на регулируемую часть цикла.
	text_label.visible = cycle_elapsed < visible_duration

	if _pause_elapsed >= _active_blink_duration:
		text_label.visible = true
		_pause_elapsed = 0.0
		_state = ScrollState.FINAL_HOLD

func _hold_at_center(delta: float) -> void:
	_pause_elapsed += delta

	if _pause_elapsed >= _active_final_hold_duration:
		_state = ScrollState.LEAVING

func _move_out(delta: float) -> void:
	text_label.position.x -= _active_scroll_speed * delta

	if text_label.position.x + text_label.size.x < 0.0:
		if _repeat_current_message:
			_restart_current_message()
			return

		_is_playing = false
		text_label.visible = false
		message_finished.emit()

func _update_static_alert(delta: float) -> void:
	_pause_elapsed += delta
	var alert_cycle_duration := alert_visible_duration + alert_hidden_duration
	var cycle_elapsed := fmod(_pause_elapsed, alert_cycle_duration)
	text_label.visible = cycle_elapsed < alert_visible_duration

func _get_center_x() -> float:
	return (size.x - text_label.size.x) * 0.5
