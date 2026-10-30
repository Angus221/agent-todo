"""Run in Blender: --background --python scripts/build-farm-cat.py -- source.glb output.glb.
Creates in-place skeletal clips; keeps the supplied source file unchanged.
"""
import bpy, math, sys
from mathutils import Vector, Quaternion

def build(source, output):
    bpy.ops.object.select_all(action='DESELECT')
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=source)
    imported=set(bpy.data.objects)-before
    arm=next(o for o in imported if o.type=='ARMATURE')
    mesh=max((o for o in imported if o.type=='MESH'),key=lambda o:len(o.data.vertices))
    bpy.context.view_layer.objects.active=arm
    bpy.ops.object.mode_set(mode='EDIT')
    for i in range(5):
        src=arm.data.edit_bones[f'tripo::1_Left_Limb_{i}']
        b=arm.data.edit_bones.new(f'tripo::1_Right_Limb_{i}')
        b.head=(src.head.x,-src.head.y,src.head.z)
        b.tail=(src.tail.x,-src.tail.y,src.tail.z)
        b.roll=-src.roll
        b.parent=arm.data.edit_bones['tripo::Root'] if i==0 else arm.data.edit_bones[f'tripo::1_Right_Limb_{i-1}']
    bpy.ops.object.mode_set(mode='OBJECT')
    for i in range(5):
        src=mesh.vertex_groups.get(f'tripo::1_Left_Limb_{i}')
        dst=mesh.vertex_groups.new(name=f'tripo::1_Right_Limb_{i}')
        if src:
            for v in mesh.data.vertices:
                if v.co.y<-.008:
                    weight=next((g.weight for g in v.groups if g.group==src.index),0)
                    if weight: dst.add([v.index],weight,'REPLACE'); src.remove([v.index])
    bpy.context.view_layer.objects.active=mesh
    mod=mesh.modifiers.new('Farm optimized topology','DECIMATE')
    mod.ratio=.035
    bpy.ops.object.modifier_apply(modifier=mod.name)
    # The supplied rig has crossed hind-leg weights and a missing right chain.
    # Smoothly repair only the affected region, retaining the face/front weights.
    def smooth(value):
        value=max(0,min(1,value));return value*value*(3-2*value)
    def distance(p,b):
        a=b.head_local; d=b.tail_local-a
        return (p-(a+d*max(0,min(1,(p-a).dot(d)/d.length_squared)))).length
    for v in mesh.data.vertices:
        p=v.co; x,y,z=p
        alpha=smooth((.46-z)/.15)*smooth((-.015-x)/.07)*smooth((x+.29)/.08)
        if not alpha:continue
        candidates=[b for b in arm.data.bones if f'1_{"Left" if y>0 else "Right"}_Limb' in b.name]
        near=sorted(((distance(p,b),b) for b in candidates),key=lambda pair:pair[0])[:3]
        weights=[1/(d+.025)**4 for d,b in near]; total=sum(weights)
        old={g.group:g.weight for g in v.groups}
        for idx,w in old.items():mesh.vertex_groups[idx].add([v.index],w*(1-alpha),'REPLACE')
        for (_,b),w in zip(near,weights):
            group=mesh.vertex_groups[b.name]
            group.add([v.index],old.get(group.index,0)*(1-alpha)+alpha*w/total,'REPLACE')
    for image in bpy.data.images:
        if image.size[0]>2048: image.scale(2048,2048)
    animate(arm)
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active=arm
    bpy.context.scene.frame_set(1)
    arm.animation_data.action=None
    for p in arm.pose.bones: p.rotation_quaternion=Quaternion(); p.location=(0,0,0)
    bpy.ops.export_scene.gltf(filepath=output,export_format='GLB',use_selection=True,
        export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True)
    print('CAT_EXPORT',output,'vertices',len(mesh.data.vertices),'triangles',len(mesh.data.polygons))

def animate(arm):
    arm.animation_data_create()
    root=arm.pose.bones['tripo::Root']
    def rotate(name,axis,angle):
        b=arm.pose.bones.get(name)
        if b:
            local=b.bone.matrix_local.to_quaternion().inverted() @ Vector(axis)
            b.rotation_quaternion=Quaternion(local,angle)
    for name,seconds in [('Idle',4),('Walk',1),('Run',.65),('Sit',4),('Sleep',20),('Alert',3),('Eat',3),('TailWag',2),('LookAround',4),('Stretch',4),('Groom',4)]:
        action=bpy.data.actions.new('Cat_'+name)
        arm.animation_data.action=action
        frames=round(seconds*24)
        for f in range(frames+1):
            t=f/frames; wave=math.sin(t*math.tau)
            for p in arm.pose.bones:
                p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion();p.location=(0,0,0)
            for i in range(5): rotate('tripo::Tail_'+str(i),(0,0,1),(.12 if name!='TailWag' else .35)*math.sin(t*math.tau-i*.35))
            rotate('tripo::Spine_2',(0,1,0),.012*wave)
            if name in ('Walk','Run'):
                for side,sign in [('Left',1),('Right',-1)]:
                    for limb,offset in [(0,1),(1,-1)]:
                        step=wave*sign*offset
                        rotate(f'tripo::{limb}_{side}_Limb_0',(0,1,0),step*(.32 if name=='Walk' else .48))
                        rotate(f'tripo::{limb}_{side}_Limb_1',(0,1,0),max(0,-step)*.32)
                        rotate(f'tripo::{limb}_{side}_Limb_2',(0,1,0),-max(0,-step)*.4)
            if name in ('Sit','Groom'):
                root.location=root.bone.matrix_local.to_quaternion().inverted() @ Vector((0,0,-.27))
                rotate('tripo::Spine_0',(0,1,0),-.65)
                rotate('tripo::Head_0',(0,1,0),.35)
                for side in ('Left','Right'):
                    for i,angle in enumerate((-.8,1.3,.4,-.9)):rotate(f'tripo::1_{side}_Limb_{i}',(0,1,0),angle)
                    rotate(f'tripo::0_{side}_Limb_0',(0,1,0),.65)
            if name in ('Sleep','Alert'):
                root.location=root.bone.matrix_local.to_quaternion().inverted() @ Vector((0,0,-.2))
                for side in ('Left','Right'):
                    for limb,angles in [(0,(.45,-1.6,2.7)),(1,(-.65,1.2,.65))]:
                        for i,angle in enumerate(angles):rotate(f'tripo::{limb}_{side}_Limb_{i}',(0,1,0),angle)
                    rotate(f'tripo::0_{side}_Limb_4',(0,1,0),-1.55)
                    rotate(f'tripo::1_{side}_Limb_3',(0,1,0),-1.2)
                # One brief head adjustment in a 20-second resting loop.
                pulse=math.sin(math.pi*(t-.55)/.18)**2 if .55<t<.73 else 0
                rotate('tripo::Head_0',(0,1,0),.34 if name=='Alert' else .45-.05*pulse)
                if name=='Sleep':
                    b=arm.pose.bones['tripo::Head_0']
                    axis=b.bone.matrix_local.to_quaternion().inverted()@Vector((0,0,1))
                    b.rotation_quaternion=Quaternion(axis,.06*pulse)@b.rotation_quaternion
                    rotate('tripo::Spine_2',(0,1,0),.008*math.sin(t*math.tau*4))
                    for i in range(5):rotate('tripo::Tail_'+str(i),(0,0,1),.025*wave)
            if name=='Eat':
                rotate('tripo::Spine_5',(0,1,0),.25)
                rotate('tripo::Head_0',(0,1,0),.65+.07*math.sin(t*math.tau*3))
            if name=='LookAround': rotate('tripo::Head_0',(0,0,1),.12*wave)
            if name=='Stretch':
                rotate('tripo::Spine_3',(0,1,0),.2*math.sin(t*math.pi)**2)
                rotate('tripo::Head_0',(0,1,0),-.2*math.sin(t*math.pi)**2)
            if name=='Groom':
                rotate('tripo::0_Left_Limb_1',(0,1,0),-1.1)
                rotate('tripo::Head_0',(0,1,0),.5+.1*wave)
            for p in arm.pose.bones:
                p.keyframe_insert('rotation_quaternion',frame=f+1,group=p.name)
                if p==root:p.keyframe_insert('location',frame=f+1,group=p.name)
        action.use_fake_user=True
    arm.animation_data.action=None
    bpy.context.scene.render.fps=24

if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:]
    build(args[0],args[1])
