local Progression = {}

local MAX_SAFE_EXPERIENCE = 9007199254740991
local MAX_CHARACTER_LEVEL = 0x7fffffff

local function is_integer(value, minimum, maximum)
	return type(value) == "number" and value == math.floor(value) and
		value >= minimum and value <= maximum
end

--- Return progress within the current level using the authoritative Caracatoa curve.
function Progression.get_level_progress(experience, level)
	if not is_integer(experience, 0, MAX_SAFE_EXPERIENCE) or
		not is_integer(level, 1, MAX_CHARACTER_LEVEL) then
		return nil
	end

	local current_level_start = 5 * level * (level - 1)
	if current_level_start > MAX_SAFE_EXPERIENCE then return nil end

	local required = 10 * level
	local earned = experience - current_level_start
	if earned < 0 then return nil end
	earned = math.min(earned, required)

	return {
		earned = earned,
		required = required,
		fraction = required > 0 and earned / required or 0,
	}
end

function Progression.format_count(value)
	local reversed = string.format("%.0f", math.floor(value)):reverse()
	local grouped = reversed:gsub("(%d%d%d)", "%1."):reverse()
	local formatted = grouped:gsub("^%.", "")
	return formatted
end

function Progression.run_self_test()
	local cases = {
		{ experience = 0, level = 1, earned = 0, required = 10 },
		{ experience = 9, level = 1, earned = 9, required = 10 },
		{ experience = 10, level = 2, earned = 0, required = 20 },
		{ experience = 29, level = 2, earned = 19, required = 20 },
		{ experience = 30, level = 3, earned = 0, required = 30 },
	}
	for _, case in ipairs(cases) do
		local progress = Progression.get_level_progress(case.experience, case.level)
		if not progress or progress.earned ~= case.earned or progress.required ~= case.required then
			return false, "Fixture de barra de experiência divergente."
		end
	end
	if Progression.get_level_progress(9, 2) ~= nil or
		Progression.get_level_progress(-1, 1) ~= nil or
		Progression.get_level_progress(0, 0) ~= nil or
		Progression.format_count(1234567) ~= "1.234.567" then
		return false, "Validação de limites/formatador de experiência divergente."
	end
	return true, "PROGRESSION_FIXTURES_PASS"
end

return Progression
