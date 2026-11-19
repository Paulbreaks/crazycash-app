class_name WinCounter
extends Control

## Длительность начисления для младших выигрышных правил (0XX…77X).
@export_range(0.1, 10.0, 0.1, "suffix:s") var small_win_credit_duration := 1.0
## Длительность начисления для комбинаций 000 и выше.
@export_range(0.1, 10.0, 0.1, "suffix:s") var major_win_credit_duration := 3.0

@onready var text_label: Label = $Text

var _animation_id := 0
var _credit_tween: Tween


func _ready() -> void:
	hide()


## Показывает серверную сумму выигрыша в центре области бегущей строки.
func show_win(payout: int) -> void:
	_animation_id += 1
	_stop_credit_tween()
	text_label.text = "WON %d" % payout
	text_label.modulate.a = 1.0
	_center_text_horizontally()
	show()


## Оставляет WIN-текст в центре: его сумма убывает до нуля, пока BAL растёт.
## Все три значения пришли с сервера: это только анимация представления.
func animate_credit(balance_label: Label, from_balance: int, to_balance: int, payout: int, duration: float) -> void:
	_animation_id += 1
	var animation_id := _animation_id
	_stop_credit_tween()
	var tween := create_tween().set_parallel(true)
	_credit_tween = tween
	tween.tween_method(_set_win_text, payout, 0, duration)
	tween.tween_method(_set_balance_text.bind(balance_label), from_balance, to_balance, duration)
	await tween.finished
	if animation_id != _animation_id:
		return
	_credit_tween = null
	balance_label.text = str(to_balance)
	hide()


## Прерывает показ и полёт WIN-текста, например при ускорении через PLAY.
func clear() -> void:
	_animation_id += 1
	_stop_credit_tween()
	hide()
	text_label.modulate.a = 1.0


func _set_win_text(value: float) -> void:
	text_label.text = "WON %d" % max(0, roundi(value))
	_center_text_horizontally()


func _set_balance_text(value: float, balance_label: Label) -> void:
	balance_label.text = str(roundi(value))


## Высоту Label задаёт сцена: она немного больше окна WinCounter и использует
## vertical_alignment = Bottom, как RunningText. Нельзя заменять size целиком
## на minimum_size: шрифт тогда получает отрицательный Y при центрировании и
## обрезается clip_contents родителя. Меняем только ширину для текущей строки.
func _center_text_horizontally() -> void:
	text_label.size.x = text_label.get_minimum_size().x
	text_label.position.x = (size.x - text_label.size.x) * 0.5


func _stop_credit_tween() -> void:
	if is_instance_valid(_credit_tween):
		_credit_tween.kill()
	_credit_tween = null
