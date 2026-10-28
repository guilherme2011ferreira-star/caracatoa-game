#version 140

in highp vec4 var_position;
in mediump vec3 var_normal;
in mediump vec2 var_texcoord0;
in mediump vec4 var_light;

out vec4 out_fragColor;

uniform mediump sampler2D tex0;

uniform fs_uniforms
{
    mediump vec4 tint;
};

void main()
{
    vec4 tint_pm = vec4(tint.xyz * tint.w, tint.w);
    vec4 color = texture(tex0, var_texcoord0.xy) * tint_pm;
    vec3 normal = normalize(var_normal);
    vec3 light_dir = normalize(var_light.xyz - var_position.xyz);
    float key_light = max(dot(normal, light_dir), 0.0);
    vec3 moon_dir = normalize(vec3(-0.45, 0.62, -0.74));
    float cool_fill = max(dot(normal, moon_dir), 0.0);
    float sky_fill = 0.08 + max(normal.y, 0.0) * 0.10;
    float illumination = clamp(0.52 + key_light * 0.38 + cool_fill * 0.07 + sky_fill, 0.45, 1.05);
    out_fragColor = vec4(color.rgb * illumination, color.a);
}
