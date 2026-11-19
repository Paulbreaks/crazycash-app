class_name WinFlash
extends Control

## Правила, для которых в сцене есть отдельная подсвечиваемая строка.
## Имя Sprite2D должно совпадать с server-side rule из результата спина.
const WIN_RULES := [
	"0XX", "7XX", "00X", "55X", "77X",
	"000", "111", "222", "444", "666",
	"333", "888", "999", "555", "777",
]

## Сколько раз строка мигнёт перед тем, как остаться включённой.
@export_range(1, 10, 1) var blink_count := 5
## Длительность видимой фазы одного мигания в секундах.
@export_range(0.05, 2.0, 0.01) var visible_duration := 0.18
## Длительность тёмной паузы между миганиями в секундах.
@export_range(0.05, 2.0, 0.01) var hidden_duration := 0.18
## Дополнительное время финальной подсветки только для крупного выигрыша.
## Малый профиль остаётся без этой задержки и сохраняет прежнюю длительность.
@export_range(0.0, 5.0, 0.01) var major_win_extra_hold_duration := 1.0

var _animation_id := 0


func _ready() -> void:
	# В редакторе подсветки могут быть случайно включены. На старте игры всегда
	# скрываем их: строку показывает только подтверждённый сервером выигрыш.
	clear()


## Малый выигрыш: прежние пять миганий без дополнительной задержки.
func flash_small_rule(rule: String) -> void:
	await _flash_rule(rule, 0.0)


## Крупный выигрыш: те же мигания и ещё одна секунда финальной подсветки.
## Это отдельный профиль, чтобы его длительность менялась независимо от малого.
func flash_major_rule(rule: String) -> void:
	await _flash_rule(rule, major_win_extra_hold_duration)


## Общая реализация двух профилей. Например rule "059" никогда не передаётся:
## API передаёт уже выбранное сервером правило "0XX".
func _flash_rule(rule: String, final_hold_duration: float) -> void:
	_animation_id += 1
	var animation_id := _animation_id
	_hide_all_lines()

	if rule not in WIN_RULES:
		push_warning("WinFlash: unknown win rule '%s'" % rule)
		return

	var winning_line := get_node_or_null(NodePath(rule)) as Sprite2D
	if winning_line == null:
		push_warning("WinFlash: missing Sprite2D for rule '%s'" % rule)
		return

	for blink_index in blink_count:
		# Новый спин или сброс во время await отменяет старую последовательность.
		if animation_id != _animation_id:
			return
		winning_line.show()
		await get_tree().create_timer(visible_duration).timeout
		if animation_id != _animation_id:
			return
		# После последнего мигания строка остаётся видимой до следующего PLAY
		# (или ошибки спина), когда Slots вызовет clear(). У крупного выигрыша
		# дополнительно удерживаем эту финальную фазу перед начислением.
		if blink_index == blink_count - 1:
			if final_hold_duration > 0.0:
				await get_tree().create_timer(final_hold_duration).timeout
				if animation_id != _animation_id:
					return
			return
		winning_line.hide()
		await get_tree().create_timer(hidden_duration).timeout


## Безопасно прерывает текущее мигание и скрывает все строки таблицы выплат.
func clear() -> void:
	_animation_id += 1
	_hide_all_lines()


func _hide_all_lines() -> void:
	for rule in WIN_RULES:
		var line := get_node_or_null(NodePath(rule)) as Sprite2D
		if line != null:
			line.hide()
