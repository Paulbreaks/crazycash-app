shader_type canvas_item;
render_mode unshaded;

// CanvasGroup передаёт собранное изображение дочерних узлов через backbuffer.
uniform sampler2D screen_texture : hint_screen_texture, repeat_disable, filter_linear;

// Настройки доступны в Inspector у Numbers -> Material -> ShaderMaterial.
uniform vec4 glow_color : source_color = vec4(1.0, 0.05, 0.08, 1.0);
uniform float glow_strength : hint_range(0.0, 1.0, 0.01) = 0.28;
uniform float glow_radius_px : hint_range(1.0, 200.0, 1.0) = 18.0;
uniform float bright_threshold : hint_range(0.0, 1.0, 0.01) = 0.58;


vec3 straight_rgb(vec4 color) {
	return color.rgb / max(color.a, 0.0001);
}


float digit_mask(vec2 uv) {
	vec3 color = straight_rgb(textureLod(screen_texture, uv, 0.0));
	return smoothstep(bright_threshold, 1.0, max(color.r, max(color.g, color.b)));
}


// 16 равномерных направлений вместо отдельных диагоналей. Три близких
// радиуса смешиваются в гладкое затухание без повторяющихся фигур цифры.
float smooth_halo(vec2 uv, vec2 radius) {
	float halo = 0.0;
	for (int index = 0; index < 16; index++) {
		float angle = float(index) * 0.39269908;
		vec2 direction = vec2(cos(angle), sin(angle));
		halo += digit_mask(uv + direction * radius * 0.35) * 0.50;
		halo += digit_mask(uv + direction * radius * 0.65) * 0.32;
		halo += digit_mask(uv + direction * radius) * 0.18;
	}
	return halo / 16.0;
}


void fragment() {
	vec4 source = textureLod(screen_texture, SCREEN_UV, 0.0);
	vec3 original_color = straight_rgb(source);
	vec2 radius = SCREEN_PIXEL_SIZE * glow_radius_px;

	// Цифры остаются исходными; красный свет рисуется только снаружи.
	float halo = smooth_halo(SCREEN_UV, radius) * (1.0 - digit_mask(SCREEN_UV));
	float glow_alpha = halo * glow_strength;
	float final_alpha = max(source.a, glow_alpha);
	vec3 final_color = original_color + glow_color.rgb * glow_alpha / max(final_alpha, 0.0001);
	COLOR = vec4(final_color, final_alpha);
}
