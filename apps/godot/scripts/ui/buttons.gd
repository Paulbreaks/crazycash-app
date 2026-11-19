class_name SlotButtons
extends Control

## Семантические сигналы кнопок. Их обрабатывает Slots: он знает текущую
## ставку и режим, а этот UI-компонент отвечает только за ввод и анимацию.
signal bet_requested
signal play_requested
signal mode_requested

@onready var bet_button: TextureButton = $BetButton
@onready var play_button: TextureButton = $PlayButton
@onready var mode_button: TextureButton = $ModeButton

func _ready() -> void:
	# `TextureButton` automatically switches texture_normal -> texture_pressed
	# while the pointer is held, and returns it on release/cancel. No positional
	# offset is used: the new pressed artwork supplies the visual feedback.
	bet_button.pressed.connect(_on_bet_button_pressed)
	play_button.pressed.connect(_on_play_button_pressed)
	mode_button.pressed.connect(_on_mode_button_pressed)


func _on_bet_button_pressed() -> void:
	bet_requested.emit()


func _on_play_button_pressed() -> void:
	play_requested.emit()


func _on_mode_button_pressed() -> void:
	mode_requested.emit()


## BET блокируется только пока серверный спин визуально крутится. PLAY временно
## блокируется лишь до ответа API, затем вновь служит для ускорения результата.
## MODE отдельно включает Slots только когда игра снова находится в готовности.
func set_bet_enabled(enabled: bool) -> void:
	bet_button.disabled = not enabled


func set_play_enabled(enabled: bool) -> void:
	play_button.disabled = not enabled


func set_mode_enabled(enabled: bool) -> void:
	mode_button.disabled = not enabled
