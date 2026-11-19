shader_type canvas_item;
render_mode unshaded;

// Telegram присылает квадратную фотографию произвольного размера. Эта маска
// обрезает её по кругу уже после масштабирования TextureRect.
void fragment() {
	vec2 from_center = UV - vec2(0.5);
	float circle_alpha = 1.0 - smoothstep(0.485, 0.5, length(from_center));

	COLOR *= texture(TEXTURE, UV);
	COLOR.a *= circle_alpha;
}
