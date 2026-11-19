class_name SessionExpiredAlert
extends Control

## Полноэкранная модалка для любой недействительной гостевой сессии. Она не
## создаёт новую сессию сама: только сообщает Slots о намерении пользователя.
signal dismissed
signal play_again_requested

## Такое же короткое смещение, как у основных игровых кнопок.
@export var pressed_offset := Vector2(0, 4)

## Крестик в старом макете был опциональным. Текущая модалка намеренно
## оставляет только PLAY AGAIN, поэтому не считаем отсутствие CloseButton
## ошибкой загрузки сцены.
@onready var close_button: TextureButton = get_node_or_null("PlayAgainModal/CloseButton") as TextureButton
# Узел был создан в редакторе с именем TextureButton; путь оставлен явным,
# чтобы не менять пользовательскую структуру сцены.
@onready var play_again_button: TextureButton = $PlayAgainModal/TextureButton

var _play_again_rest_position := Vector2.ZERO


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	_play_again_rest_position = play_again_button.position
	if close_button != null:
		close_button.pressed.connect(_on_close_pressed)
	play_again_button.button_down.connect(_on_play_again_down)
	play_again_button.button_up.connect(_on_play_again_up)
	play_again_button.focus_exited.connect(_on_play_again_up)
	play_again_button.pressed.connect(_on_play_again_pressed)
	hide()


func show_alert() -> void:
	play_again_button.position = _play_again_rest_position
	play_again_button.disabled = false
	show()


func _on_close_pressed() -> void:
	hide()
	dismissed.emit()


func _on_play_again_down() -> void:
	play_again_button.position = _play_again_rest_position + pressed_offset


func _on_play_again_up() -> void:
	play_again_button.position = _play_again_rest_position


func _on_play_again_pressed() -> void:
	_on_play_again_up()
	# Блокируем повторный клик, пока React Shell переходит на entry page.
	play_again_button.disabled = true
	play_again_requested.emit()
