## Тонкий транспорт между Web-экспортом Godot и React Shell.
##
## Игровая логика не должна напрямую обращаться к API: Shell отвечает за
## авторизацию, HTTP-запросы и повторную отправку результата в игру.
class_name WebBridge
extends RefCounted

static var _shell_message_receiver: Callable
static var _message_callback: JavaScriptObject
static var _decimal_input_callback: JavaScriptObject
static var _is_listening := false


## Отправляет JSON-совместимое сообщение родительскому окну Shell.
## В запуске из редактора или desktop-версии это намеренно ничего не делает.
static func post_to_shell(message: Dictionary) -> void:
	if not OS.has_feature("web"):
		return

	# JSON.stringify безопасно экранирует текст внутри payload для JavaScript.
	var message_json := JSON.stringify(message)
	JavaScriptBridge.eval(
		"window.parent.postMessage(%s, window.location.origin);" % message_json
	)


## Подписывает Web-экспорт на postMessage от родительского Shell.
## Ссылка на callback хранится обязательно: иначе JavaScript может собрать его
## сборщиком мусора и сообщения перестанут доходить до Godot.
static func start_listening(receiver: Callable) -> void:
	if not OS.has_feature("web"):
		return

	_shell_message_receiver = receiver
	if _is_listening:
		return

	_message_callback = JavaScriptBridge.create_callback(_on_browser_message)
	var browser_window := JavaScriptBridge.get_interface("window")
	browser_window.addEventListener("message", _message_callback)
	_is_listening = true


static func _on_browser_message(arguments: Array) -> void:
	if arguments.is_empty() or not _shell_message_receiver.is_valid():
		return

	var browser_event = arguments[0]
	var browser_window := JavaScriptBridge.get_interface("window")
	if browser_event.origin != browser_window.location.origin:
		return

	# Browser event.data может быть JavaScriptObject. Сначала сериализуем его в
	# JavaScript, затем безопасно разбираем обычный JSON уже в GDScript.
	var browser_json := JavaScriptBridge.get_interface("JSON")
	var message_json = browser_json.stringify(browser_event.data)
	if not message_json is String:
		return

	var message = JSON.parse_string(message_json)
	if message is Dictionary:
		_shell_message_receiver.call(message)


## On mobile WebView, a real DOM input is more reliable than Godot's
## experimental canvas keyboard. Godot keeps drawing/validating the field; the
## DOM element merely obtains the OS keyboard and returns a bounded text value.
static func request_decimal_input(initial_value: String, max_length: int, receiver: Callable) -> bool:
	if not OS.has_feature("web"):
		return false

	var decimal_input := JavaScriptBridge.get_interface("CrazyCashDecimalInput")
	if decimal_input == null:
		return false

	_decimal_input_callback = JavaScriptBridge.create_callback(
		func(arguments: Array) -> void:
			if arguments.is_empty() or not receiver.is_valid():
				return
			var value = arguments[0]
			if value is String:
				receiver.call(value)
	)
	decimal_input.open(initial_value, max_length, _decimal_input_callback)
	return true


static func dismiss_decimal_input() -> void:
	if not OS.has_feature("web"):
		return
	var decimal_input := JavaScriptBridge.get_interface("CrazyCashDecimalInput")
	if decimal_input != null:
		decimal_input.close()
	_decimal_input_callback = null
