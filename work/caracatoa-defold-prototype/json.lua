-- Small, dependency-free JSON codec for the local Caracatoa client.
-- Supports the JSON values used by the Caracatoa HTTP/socket contracts.
local json = { null = {} }
local array_mt = { __json_array = true }

local function utf8_char(codepoint)
	if codepoint < 0x80 then return string.char(codepoint) end
	if codepoint < 0x800 then
		return string.char(0xC0 + math.floor(codepoint / 0x40), 0x80 + codepoint % 0x40)
	end
	if codepoint < 0x10000 then
		return string.char(0xE0 + math.floor(codepoint / 0x1000), 0x80 + math.floor(codepoint / 0x40) % 0x40, 0x80 + codepoint % 0x40)
	end
	return string.char(0xF0 + math.floor(codepoint / 0x40000), 0x80 + math.floor(codepoint / 0x1000) % 0x40, 0x80 + math.floor(codepoint / 0x40) % 0x40, 0x80 + codepoint % 0x40)
end

local function hex4(source, position)
	local digits = source:sub(position, position + 3)
	if #digits ~= 4 or not digits:match("^%x%x%x%x$") then error("escape Unicode inválido", 0) end
	return tonumber(digits, 16)
end

function json.decode(source)
	if type(source) ~= "string" then error("JSON precisa ser texto", 2) end
	local position = 1
	local length = #source
	local parse_value

	local function fail(message)
		error(string.format("JSON inválido na posição %d: %s", position, message), 0)
	end

	local function whitespace()
		while position <= length do
			local byte = source:byte(position)
			if byte == 0x20 or byte == 0x09 or byte == 0x0A or byte == 0x0D then position = position + 1 else break end
		end
	end

	local function parse_string()
		position = position + 1
		local parts = {}
		local start = position
		while position <= length do
			local byte = source:byte(position)
			if byte == 0x22 then
				parts[#parts + 1] = source:sub(start, position - 1)
				position = position + 1
				return table.concat(parts)
			elseif byte == 0x5C then
				parts[#parts + 1] = source:sub(start, position - 1)
				position = position + 1
				local escaped = source:sub(position, position)
				local replacements = { ['"'] = '"', ['\\'] = '\\', ['/'] = '/', b = '\b', f = '\f', n = '\n', r = '\r', t = '\t' }
				if replacements[escaped] then
					parts[#parts + 1] = replacements[escaped]
					position = position + 1
				elseif escaped == "u" then
					local codepoint = hex4(source, position + 1)
					position = position + 5
					if codepoint >= 0xD800 and codepoint <= 0xDBFF then
						if source:sub(position, position + 1) ~= "\\u" then fail("par substituto Unicode ausente") end
						local low = hex4(source, position + 2)
						if low < 0xDC00 or low > 0xDFFF then fail("par substituto Unicode inválido") end
						codepoint = 0x10000 + (codepoint - 0xD800) * 0x400 + low - 0xDC00
						position = position + 6
					elseif codepoint >= 0xDC00 and codepoint <= 0xDFFF then
						fail("substituto Unicode isolado")
					end
					parts[#parts + 1] = utf8_char(codepoint)
				else
					fail("escape de texto inválido")
				end
				start = position
			elseif byte < 0x20 then
				fail("caractere de controle em texto")
			else
				position = position + 1
			end
		end
		fail("texto sem fechamento")
	end

	local function parse_number()
		local start = position
		if source:sub(position, position) == "-" then position = position + 1 end
		local first = source:sub(position, position)
		if first == "0" then
			position = position + 1
			if source:sub(position, position):match("%d") then fail("zero inicial em número") end
		elseif first:match("[1-9]") then
			position = position + 1
			while source:sub(position, position):match("%d") do position = position + 1 end
		else
			fail("número inválido")
		end
		if source:sub(position, position) == "." then
			position = position + 1
			if not source:sub(position, position):match("%d") then fail("fração sem dígitos") end
			while source:sub(position, position):match("%d") do position = position + 1 end
		end
		local exponent = source:sub(position, position)
		if exponent == "e" or exponent == "E" then
			position = position + 1
			local sign = source:sub(position, position)
			if sign == "+" or sign == "-" then position = position + 1 end
			if not source:sub(position, position):match("%d") then fail("expoente sem dígitos") end
			while source:sub(position, position):match("%d") do position = position + 1 end
		end
		local number = tonumber(source:sub(start, position - 1))
		if not number or number == math.huge or number == -math.huge then fail("número fora do intervalo") end
		return number
	end

	local function parse_array(depth)
		if depth > 128 then fail("JSON excede profundidade máxima") end
		position = position + 1
		whitespace()
		local result = setmetatable({}, array_mt)
		if source:sub(position, position) == "]" then position = position + 1; return result end
		while true do
			result[#result + 1] = parse_value(depth + 1)
			whitespace()
			local delimiter = source:sub(position, position)
			if delimiter == "]" then position = position + 1; return result end
			if delimiter ~= "," then fail("esperado ',' ou ']' em array") end
			position = position + 1
			whitespace()
		end
	end

	local function parse_object(depth)
		if depth > 128 then fail("JSON excede profundidade máxima") end
		position = position + 1
		whitespace()
		local result = {}
		if source:sub(position, position) == "}" then position = position + 1; return result end
		while true do
			if source:sub(position, position) ~= '"' then fail("chave de objeto precisa ser texto") end
			local key = parse_string()
			whitespace()
			if source:sub(position, position) ~= ":" then fail("esperado ':' após chave") end
			position = position + 1
			whitespace()
			result[key] = parse_value(depth + 1)
			whitespace()
			local delimiter = source:sub(position, position)
			if delimiter == "}" then position = position + 1; return result end
			if delimiter ~= "," then fail("esperado ',' ou '}' em objeto") end
			position = position + 1
			whitespace()
		end
	end

	parse_value = function(depth)
		whitespace()
		local token = source:sub(position, position)
		if token == '"' then return parse_string() end
		if token == "{" then return parse_object(depth + 1) end
		if token == "[" then return parse_array(depth + 1) end
		if token == "-" or token:match("%d") then return parse_number() end
		if source:sub(position, position + 3) == "true" then position = position + 4; return true end
		if source:sub(position, position + 4) == "false" then position = position + 5; return false end
		if source:sub(position, position + 3) == "null" then position = position + 4; return json.null end
		fail("valor esperado")
	end

	local result = parse_value(0)
	whitespace()
	if position <= length then fail("dados após o valor principal") end
	return result
end

function json.array(values)
	return setmetatable(values or {}, array_mt)
end

function json.encode(value)
	local seen = {}
	local function quote(text)
		return '"' .. text:gsub('[%z\1-\31\\"]', function(char)
			local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
			return escapes[char] or string.format("\\u%04x", char:byte())
		end) .. '"'
	end
	local encode_value
	encode_value = function(item, depth)
		if depth > 128 then error("JSON excede profundidade máxima", 0) end
		local kind = type(item)
		if item == json.null then return "null" end
		if kind == "nil" then error("JSON não pode codificar nil diretamente", 0) end
		if kind == "boolean" then return item and "true" or "false" end
		if kind == "number" then
			if item ~= item or item == math.huge or item == -math.huge then error("JSON não pode codificar NaN ou infinito", 0) end
			return tostring(item)
		end
		if kind == "string" then return quote(item) end
		if kind ~= "table" then error("tipo não suportado em JSON: " .. kind, 0) end
		if seen[item] then error("referência circular em JSON", 0) end
		seen[item] = true
		local count, maximum, all_integer_keys = 0, 0, true
		for key in pairs(item) do
			count = count + 1
			if type(key) == "number" and key >= 1 and key == math.floor(key) then
				maximum = math.max(maximum, key)
			else
				all_integer_keys = false
			end
		end
		local is_array = getmetatable(item) == array_mt or (count > 0 and all_integer_keys)
		if is_array and maximum ~= count then error("array JSON precisa ter índices contíguos", 0) end
		local output = {}
		if is_array then
			for index = 1, maximum do output[index] = encode_value(item[index], depth + 1) end
			seen[item] = nil
			return "[" .. table.concat(output, ",") .. "]"
		end
		local keys = {}
		for key in pairs(item) do
			if type(key) ~= "string" then error("objeto JSON requer chaves de texto", 0) end
			keys[#keys + 1] = key
		end
		table.sort(keys)
		for _, key in ipairs(keys) do output[#output + 1] = quote(key) .. ":" .. encode_value(item[key], depth + 1) end
		seen[item] = nil
		return "{" .. table.concat(output, ",") .. "}"
	end
	return encode_value(value, 0)
end

return json
