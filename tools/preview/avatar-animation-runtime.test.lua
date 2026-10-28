-- Execute the production script with controlled Defold API boundaries.
-- Run from repository root with the LuaJIT bundled in Defold's bob.jar.
local script = arg[1] or "work/caracatoa-defold-prototype/main/avatar_animation.script"
local calls, callbacks, transforms
hash = function(value) return value end
vmath = { vector3 = function(x,y,z) return {x=x,y=y,z=z} end,
  quat_rotation_y = function(value) return value end }
go = {
  PLAYBACK_LOOP_FORWARD = 1, PLAYBACK_ONCE_FORWARD = 2,
  get_position = function() return {x=0,y=0,z=0} end,
  get_rotation = function() return 0 end, get_scale = function() return 1 end,
  set_position = function() transforms = transforms + 1 end,
  set_rotation = function() transforms = transforms + 1 end,
  set_scale = function() transforms = transforms + 1 end,
  animate = function() error("Animation controller must not override authoritative root movement") end,
}
model = { play_anim = function(url, animation, mode, options, callback)
  calls[#calls+1] = {animation=animation,mode=mode}
  if callback then callbacks[#callbacks+1] = callback end
end }
dofile(script)
local function fresh()
  calls, callbacks, transforms = {}, {}, 0
  local state = {}; init(state); return state
end
local function send(state,id,message) on_message(state,id,message or {},nil) end
local function locomotion(state,name) send(state,"set_avatar_animation",{animation=name}) end
local function strike(state,name) send(state,"combat_attack",{animation=name or "Caracatoa_TK_Slash",dx=1,dz=0,yaw=90}) end
local function done(index) callbacks[index or #callbacks](nil,"model_animation_done",{}) end
local function last(name) assert(calls[#calls].animation == name, "expected "..name..", got "..calls[#calls].animation) end
local passed = 0
local function test(name,fn) fn(); passed=passed+1; print("PASS "..name) end

test("all four class strikes finish into idle without moving the root",function()
  for _,name in ipairs({"Caracatoa_TK_Slash","Caracatoa_Foema_Cast","Caracatoa_BM_Heavy","Caracatoa_HT_Shot"}) do
    local s=fresh(); strike(s,name); last(name)
    assert(calls[#calls].mode==go.PLAYBACK_ONCE_FORWARD)
    done(); last("Idle_Loop"); assert(not s.attacking); assert(transforms==0)
  end
end)
test("walking resumes after attack without another movement key message",function()
  local s=fresh(); locomotion(s,"Walk_Loop"); strike(s); done(); last("Walk_Loop")
end)
test("key release queues idle without truncating attack",function()
  local s=fresh(); locomotion(s,"Walk_Loop"); strike(s); local count=#calls
  locomotion(s,"Idle_Loop"); assert(#calls==count); done(); last("Idle_Loop")
end)
test("movement start queues walking without truncating attack",function()
  local s=fresh(); strike(s); local count=#calls
  locomotion(s,"Walk_Loop"); assert(#calls==count); done(); last("Walk_Loop")
end)
test("authority updates cannot strand the avatar in its final attack pose",function()
  local s=fresh(); locomotion(s,"Walk_Loop"); strike(s)
  send(s,"world_anchor_updated",{x=6,y=0,z=3,yaw=90})
  assert(s.home_position.x==6 and s.home_position.z==3)
  assert(transforms==0); done(); last("Walk_Loop"); assert(not s.attacking)
end)
test("stale completion cannot interrupt a newer attack",function()
  local s=fresh(); strike(s); strike(s,"Caracatoa_Foema_Cast"); local count=#calls
  done(1); assert(#calls==count and s.attacking)
  done(2); last("Idle_Loop"); assert(not s.attacking)
end)
test("preview transition invalidates attack callbacks",function()
  local s=fresh(); strike(s); send(s,"creator_overview"); local count=#calls
  done(); assert(#calls==count and not s.attacking); last("Idle_Loop")
end)
test("unrelated notifications and invalid animation requests do nothing",function()
  local s=fresh(); strike(s); local count=#calls
  callbacks[1](nil,"unrelated",{}); locomotion(s,"Unknown")
  send(s,"world_anchor_updated",{x="bad",y=0,z=0,yaw=0})
  assert(#calls==count and s.attacking); done(); last("Idle_Loop")
end)
print(string.format("%d runtime scenarios passed",passed))

-- Exercise actual player message handling, including target-facing ownership.
dofile("work/caracatoa-defold-prototype/main/player.script")
local turns, sent
local function player_state()
  turns, sent = {}, {}
  return {world_active=true,avatar_id="foema",world_x=128,world_y=128,facing_yaw=0}
end
go.animate = function(url,property,mode,value) turns[#turns+1]={property=property,value=value} end
msg = {post=function(url,id,message) sent[#sent+1]={id=id,message=message} end}
test("stationary confirmed attack faces target and selects the class clip",function()
  local s=player_state()
  send(s,"world_attack_confirmed",{target_x=129,target_y=128})
  assert(#turns==1 and turns[1].property=="rotation" and s.facing_yaw==90)
  assert(#sent==1 and sent[1].id=="combat_attack")
  assert(sent[1].message.animation=="Caracatoa_Foema_Cast")
end)
test("moving or awaiting authority preserves the movement-owned rotation",function()
  for _,field in ipairs({"forward","awaiting_authority"}) do
    local s=player_state(); s[field]=true
    send(s,"world_attack_confirmed",{target_x=129,target_y=128})
    assert(#turns==0 and #sent==1 and s.facing_yaw==0)
  end
end)
test("inactive world ignores late attack confirmations",function()
  local s=player_state(); s.world_active=false
  send(s,"world_attack_confirmed",{target_x=129,target_y=128})
  assert(#turns==0 and #sent==0)
end)
print(string.format("%d total runtime scenarios passed",passed))
