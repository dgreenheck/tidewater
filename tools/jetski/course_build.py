# Jetski buoy course props for Tidewater Bay (src/jetski/Course.js): slalom buoys, turn marker,
# inflatable start / finish arch, floating kicker ramp, mooring line. Brand-free "TIDEWATER BAY" print.
# Run: Blender -b --factory-startup --python tools/jetski/course_build.py  ->  public/models/jetski_course.glb
# Blender is Z up; glTF is Y up with Blender -Y as glTF +Z (the ramp runs along Blender -Y).
import bpy, bmesh, math, os
from mathutils import Vector

OUT = os.path.join( os.path.dirname( os.path.abspath( __file__ ) ), '..', '..', 'public', 'models', 'jetski_course.glb' )
# ramp numbers shared with src/jetski/Course.js (RAMP): length, half width, top at the nose / lip, bottom
RAMP_L, RAMP_HW, RAMP_Y0, RAMP_Y1, RAMP_BOT = 4.0, 1.3, - 0.08, 1.0, - 0.25

bpy.ops.wm.read_factory_settings( use_empty = True )

def mat( name, rgb, rough = 0.3, metal = 0.0, emit = None, coat = 0.0 ):
	m = bpy.data.materials.new( name ); m.use_nodes = True
	b = m.node_tree.nodes[ 'Principled BSDF' ]
	b.inputs[ 'Base Color' ].default_value = ( *rgb, 1 )
	b.inputs[ 'Roughness' ].default_value = rough
	b.inputs[ 'Metallic' ].default_value = metal
	if coat and 'Coat Weight' in b.inputs: b.inputs[ 'Coat Weight' ].default_value = coat
	if emit:
		b.inputs[ 'Emission Color' ].default_value = ( *emit, 1 ); b.inputs[ 'Emission Strength' ].default_value = 4.0
	return m

M = {
	'red': mat( 'PVC_Red', ( 0.62, 0.035, 0.03 ), 0.26, coat = 0.4 ),
	'yellow': mat( 'PVC_Yellow', ( 0.86, 0.56, 0.03 ), 0.26, coat = 0.4 ),
	'blue': mat( 'PVC_Blue', ( 0.03, 0.14, 0.48 ), 0.27, coat = 0.4 ),
	'white': mat( 'PVC_White', ( 0.82, 0.83, 0.82 ), 0.3, coat = 0.3 ),
	'ink': mat( 'Print_Navy', ( 0.02, 0.03, 0.09 ), 0.45 ),
	'inkw': mat( 'Print_White', ( 0.9, 0.9, 0.88 ), 0.4 ),
	'black': mat( 'Check_Black', ( 0.015, 0.015, 0.018 ), 0.5 ),
	'base': mat( 'Ballast_Grey', ( 0.08, 0.09, 0.1 ), 0.55 ),
	'deck': mat( 'Ramp_Grip', ( 0.035, 0.037, 0.04 ), 0.88 ),
	'hdpe': mat( 'Ramp_HDPE_Yellow', ( 0.85, 0.5, 0.02 ), 0.34 ),
	'edge': mat( 'Ramp_Edge_Orange', ( 0.9, 0.2, 0.02 ), 0.3 ),
	'foam': mat( 'Ramp_Foam', ( 0.66, 0.68, 0.66 ), 0.92 ),
	'rope': mat( 'Mooring_Rope', ( 0.2, 0.16, 0.1 ), 0.9 ),
	'valve': mat( 'Valve_Grey', ( 0.06, 0.062, 0.068 ), 0.42 ),
	'steel': mat( 'Stainless', ( 0.62, 0.62, 0.6 ), 0.22, metal = 1.0 ),
	'webbing': mat( 'Webbing_Black', ( 0.018, 0.02, 0.024 ), 0.8 ),
	'flash': mat( 'Buoy_Flash', ( 1.0, 0.25, 0.1 ), 0.4, emit = ( 1.0, 0.18, 0.06 ) ),
}

def obj_from_bm( name, bm, mats ):
	me = bpy.data.meshes.new( name ); bm.to_mesh( me ); bm.free()
	for m in mats: me.materials.append( m )
	o = bpy.data.objects.new( name, me ); bpy.context.collection.objects.link( o )
	for p in me.polygons: p.use_smooth = True
	return o

def lathe( bm, prof, n = 48, seam_every = 8, seam = 0.012, mi = 0, rscale = 1.0 ):
	# profile [(r, z)], vertical weld seams as narrow ridges every `seam_every` segments
	rings = []
	for ( r, z ) in prof:
		ring = []
		for i in range( n ):
			a = 2 * math.pi * i / n
			rr = r * rscale + ( seam if seam_every and i % seam_every == 0 and r > 0.05 else 0 )
			ring.append( bm.verts.new( ( rr * math.cos( a ), rr * math.sin( a ), z ) ) )
		rings.append( ring )
	for j in range( len( rings ) - 1 ):
		for i in range( n ):
			f = bm.faces.new( ( rings[ j ][ i ], rings[ j ][ ( i + 1 ) % n ], rings[ j + 1 ][ ( i + 1 ) % n ], rings[ j + 1 ][ i ] ) ); f.material_index = mi
	top = bm.faces.new( rings[ - 1 ] ); top.material_index = mi
	bot = bm.faces.new( list( reversed( rings[ 0 ] ) ) ); bot.material_index = mi
	return rings

def text_mesh( body, size, extrude = 0.004 ):
	# flat text in the XZ plane (reads along +X, up +Z), front facing -Y; returns bmesh of it
	bpy.ops.object.text_add( location = ( 0, 0, 0 ) )
	t = bpy.context.object; t.data.body = body; t.data.size = size; t.data.extrude = extrude
	t.data.align_x = 'CENTER'; t.data.align_y = 'CENTER'
	t.rotation_euler = ( math.pi / 2, 0, 0 )
	bpy.ops.object.convert( target = 'MESH' ); bpy.ops.object.transform_apply( rotation = True )
	bm = bmesh.new(); bm.from_mesh( t.data ); bpy.data.objects.remove( t )
	return bm

def add_bm( dst, src, fn, mi ):
	# copy src into dst with vertex map fn(co) -> co and material index mi
	vm = {}
	for v in src.verts: vm[ v ] = dst.verts.new( fn( v.co ) )
	for f in src.faces:
		try: nf = dst.faces.new( [ vm[ v ] for v in f.verts ] ); nf.material_index = mi
		except ValueError: pass
	src.free()

def wrap_text( bm, body, r, z, size, mi, turns = ( 0.0, math.pi ) ):
	for off in turns:
		t = text_mesh( body, size )
		add_bm( bm, t, lambda c, off = off: Vector( ( math.sin( c.x / r + off ) * ( r - c.y ), - math.cos( c.x / r + off ) * ( r - c.y ), z + c.z ) ), mi )

def mixc( a, b, t ): return tuple( a[ i ] * ( 1 - t ) + b[ i ] * t for i in range( 3 ) )

def torus( bm, c, u, v, R, r, nM = 16, nm = 6, mi = 0 ):
	# ring of radius R in the plane (u, v) round c, tube radius r
	w = u.cross( v ).normalized(); rings = []
	for i in range( nM ):
		a = 2 * math.pi * i / nM; d = u * math.cos( a ) + v * math.sin( a )
		rings.append( [ bm.verts.new( c + d * ( R + r * math.cos( 2 * math.pi * j / nm ) ) + w * ( r * math.sin( 2 * math.pi * j / nm ) ) ) for j in range( nm ) ] )
	for i in range( nM ):
		for j in range( nm ):
			f = bm.faces.new( ( rings[ i ][ j ], rings[ ( i + 1 ) % nM ][ j ], rings[ ( i + 1 ) % nM ][ ( j + 1 ) % nm ], rings[ i ][ ( j + 1 ) % nm ] ) ); f.material_index = mi

def buoy( name, rgb, ink, h = 1.7, rb = 0.46, n = 48 ):
	bm = bmesh.new(); bm_verts = bm.verts; bm_verts_faces = bm.faces.new
	# An inflatable racing marker: a PVC cylinder welded from 8 gores (narrow seam ridges, each panel pillowed
	# out by the pressure), a welded dome and a base seam, a ballast skirt below the waterline. Printed band and
	# pinstripe (no sponsor), glossy wet PVC above the waterline, a scum line at the waterline, a Boston valve on
	# the dome shoulder, webbing handles either side and a stainless tie-down ring under it for the anchor line.
	# Origin at the waterline (Course.js floats it there); same size and outline as before (colliders unchanged).
	k = rb / 0.46; per = n // 8; z0 = h - rb * 0.55; rt = rb * 0.84
	shell = mat( name + '_PVC', rgb, 0.3, coat = 0.35 )
	wet = mat( name + '_PVC_Wet', mixc( rgb, ( 0, 0, 0 ), 0.12 ), 0.1, coat = 1.0 )
	stain = mat( name + '_Waterline', mixc( mixc( rgb, ( 0.1, 0.11, 0.05 ), 0.72 ), ( 0.02, 0.03, 0.01 ), 0.2 ), 0.55 )
	stainL = mat( name + '_Tideline', mixc( rgb, ( 0.28, 0.25, 0.13 ), 0.42 ), 0.35, coat = 0.5 )
	mats = [ shell, wet, stain, stainL, ink, M[ 'base' ], M[ 'valve' ], M[ 'steel' ], M[ 'webbing' ] ]
	SH, WET, ST, STL, INK, BASE, VALVE, STEEL, WEB = range( 9 )
	# printed band and pinstripe, the wet sheen and the stain, as z ranges (m, scaled with the buoy)
	band = ( 0.95 * k, 1.17 * k ); pin = ( 0.84 * k, 0.875 * k )
	def mi_at( z ):
		if z < 0.015 * k: return ST
		if z < 0.1 * k: return STL
		if z < 0.42 * k: return WET
		if band[ 0 ] <= z < band[ 1 ] or pin[ 0 ] <= z < pin[ 1 ]: return INK
		return SH
	# rings: body (with the band edges, and a welded seam at the base and at the dome as a narrow ridge)
	zs = sorted( set( [ round( - 0.3 * k + i * ( z0 + 0.3 * k ) / 22, 4 ) for i in range( 23 ) ] + [ 0.015 * k, 0.1 * k, 0.42 * k, band[ 0 ], band[ 1 ], pin[ 0 ], pin[ 1 ], 0.07 * k, 0.082 * k, 0.094 * k, z0 - 0.012 * k ] ) )
	prof = [ ( rb * 0.8, - 0.34 * k, 0.0 ), ( rb * 1.02, - 0.31 * k, 0.0 ) ]
	for z in zs:
		if z < - 0.3 * k or z > z0 - 0.012 * k: continue
		ridge = 0.008 * k if abs( z - 0.082 * k ) < 1e-4 else 0.0
		env = math.sin( math.pi * min( 1, max( 0, ( z + 0.3 * k ) / ( z0 + 0.3 * k ) ) ) ) ** 0.6
		prof.append( ( rb * ( 1.0 - 0.18 * max( z, 0 ) / h ) + ridge, z, env ) )
	prof.append( ( rb * ( 1.0 - 0.18 * z0 / h ) + 0.008 * k, z0, 0.0 ) )
	for i in range( 1, 11 ):
		a = i / 10 * math.pi / 2
		prof.append( ( rt * math.cos( a ) + ( rb * ( 1.0 - 0.18 * z0 / h ) - rt ) * ( 1 - math.sin( a ) ) * ( 1 - i / 10 ) + 0.001, z0 + rb * 0.55 * math.sin( a ), 0.35 * math.sin( math.pi * i / 10 ) ) )
	rings = []
	for ( r, z, env ) in prof:
		ring = []
		for i in range( n ):
			a = 2 * math.pi * i / n; u = ( i % per ) / per
			rr = r + ( 0.006 * k if i % per == 0 and r > 0.05 else 0.0 ) + 0.013 * k * env * math.sin( math.pi * u )
			ring.append( bm_verts.new( ( rr * math.cos( a ), rr * math.sin( a ), z ) ) )
		rings.append( ring )
	for j in range( len( rings ) - 1 ):
		zm = ( prof[ j ][ 1 ] + prof[ j + 1 ][ 1 ] ) / 2
		for i in range( n ):
			f = bm_verts_faces( ( rings[ j ][ i ], rings[ j ][ ( i + 1 ) % n ], rings[ j + 1 ][ ( i + 1 ) % n ], rings[ j + 1 ][ i ] ) ); f.material_index = mi_at( zm )
	top = bm_verts_faces( rings[ - 1 ] ); top.material_index = SH
	bot = bm_verts_faces( list( reversed( rings[ 0 ] ) ) ); bot.material_index = ST
	# ballast skirt below the waterline
	lathe( bm, [ ( rb * 1.08, - 0.38 * k ), ( rb * 1.1, - 0.28 * k ), ( rb * 1.06, - 0.16 * k ), ( rb * 0.5, - 0.16 * k ) ], n, 0, mi = BASE )
	# Boston valve on the dome shoulder: flange, body and screw cap along the dome's normal
	av = 0.5; vr = rt * math.cos( av ) + 0.003; vz = z0 + rb * 0.55 * math.sin( av )
	nrm = Vector( ( math.cos( av ) * rb * 0.55, 0, math.sin( av ) * rt ) ).normalized(); ax = Vector( ( 0, 1, 0 ) ); ay = nrm.cross( ax ).normalized()
	base = Vector( ( vr, 0, vz ) ) - nrm * 0.004
	vb = bmesh.new()
	lathe( vb, [ ( 0.046 * k, 0.0 ), ( 0.046 * k, 0.008 * k ), ( 0.03 * k, 0.012 * k ), ( 0.03 * k, 0.04 * k ), ( 0.036 * k, 0.042 * k ), ( 0.036 * k, 0.062 * k ), ( 0.03 * k, 0.066 * k ) ], 16, 0, mi = 0 )
	add_bm( bm, vb, lambda c: base + ax * c.x + ay * c.y + nrm * c.z, VALVE )
	# webbing handles either side (flush straps, stitched at both ends) and the tie-down ring under the ballast
	for sx in ( 1, - 1 ):
		for ( zc, hz ) in ( ( 0.2 * k, 0.012 * k ), ( 0.32 * k, 0.012 * k ) ):
			box( bm, ( sx * ( rb * 1.0 + 0.012 * k ), 0, zc ), ( 0.014 * k, 0.05 * k, hz * 2 ), WEB )
		box( bm, ( sx * ( rb * 1.0 + 0.03 * k ), 0, 0.26 * k ), ( 0.012 * k, 0.05 * k, 0.13 * k ), WEB )
	box( bm, ( 0, 0, - 0.41 * k ), ( 0.05 * k, 0.014 * k, 0.07 * k ), WEB )
	torus( bm, Vector( ( 0, 0, - 0.47 * k ) ), Vector( ( 1, 0, 0 ) ), Vector( ( 0, 0, 1 ) ), 0.04 * k, 0.007 * k, 16, 6, STEEL )
	bmesh.ops.recalc_face_normals( bm, faces = bm.faces )
	return obj_from_bm( name, bm, mats )

def tube( bm, path, rad, n = 20, mi = 0 ):
	rings = []
	for k, ( p, t ) in enumerate( path ):
		t = t.normalized(); a = Vector( ( 0, 1, 0 ) ); b = t.cross( a ).normalized(); a = b.cross( t ).normalized()
		r = rad( k ) if callable( rad ) else rad
		rings.append( [ bm.verts.new( p + ( a * math.cos( 2 * math.pi * i / n ) + b * math.sin( 2 * math.pi * i / n ) ) * r ) for i in range( n ) ] )
	for j in range( len( rings ) - 1 ):
		for i in range( n ):
			f = bm.faces.new( ( rings[ j ][ i ], rings[ j ][ ( i + 1 ) % n ], rings[ j + 1 ][ ( i + 1 ) % n ], rings[ j + 1 ][ i ] ) ); f.material_index = mi
	for ring, rev in ( ( rings[ 0 ], True ), ( rings[ - 1 ], False ) ):
		f = bm.faces.new( list( reversed( ring ) ) if rev else ring ); f.material_index = mi

def box( bm, c, s, mi ):
	r = bmesh.ops.create_cube( bm, size = 1.0 )
	for v in r[ 'verts' ]: v.co = Vector( ( c[ 0 ] + v.co.x * s[ 0 ], c[ 1 ] + v.co.y * s[ 1 ], c[ 2 ] + v.co.z * s[ 2 ] ) )
	for f in { f for v in r[ 'verts' ] for f in v.link_faces }: f.material_index = mi

def arch():
	# span 13 m between leg centres, 7.4 m crest, 0.56 m tube in 0.9 m chambers pinched at the welds
	bm = bmesh.new(); R, Hc, r0 = 6.5, 7.4, 0.56
	path = [ ( Vector( ( - R, 0, 0.25 + 1.6 * i / 6 ) ), Vector( ( 0, 0, 1 ) ) ) for i in range( 6 ) ]
	N = 96
	for i in range( N + 1 ):
		t = math.pi * ( 1 - i / N )
		p = Vector( ( R * math.cos( t ), 0, 1.85 + ( Hc - 1.85 ) * math.sin( t ) ) )
		d = Vector( ( - R * math.sin( t ), 0, ( Hc - 1.85 ) * math.cos( t ) ) ) * - 1
		path.append( ( p, d ) )
	path += [ ( Vector( ( R, 0, 1.85 - 1.6 * i / 6 ) ), Vector( ( 0, 0, - 1 ) ) ) for i in range( 1, 7 ) ]
	L = [ 0.0 ]
	for k in range( 1, len( path ) ): L.append( L[ - 1 ] + ( path[ k ][ 0 ] - path[ k - 1 ][ 0 ] ).length )
	tube( bm, path, lambda k: r0 * ( 0.93 + 0.07 * abs( math.sin( math.pi * L[ k ] / 0.9 ) ) ), 24, 0 )
	for sx in ( - R, R ):  # weighted base floats
		lathe( bm, [ ( 0.95, - 0.3 ), ( 1.0, 0.0 ), ( 0.95, 0.3 ), ( 0.45, 0.34 ) ], 32, 0, mi = 2 )
		for v in bm.verts[ - 32 * 4: ]: v.co.x += sx
	# banner under the crest: print on blue, a checkered finish strip below it (both faces)
	bw, bz = 7.2, Hc - 1.35
	box( bm, ( 0, 0, bz ), ( bw, 0.06, 0.9 ), 3 )
	for side in ( - 1, 1 ):
		t = text_mesh( 'TIDEWATER BAY', 0.55 )
		add_bm( bm, t, lambda c, side = side: Vector( ( c.x * - side, side * ( 0.035 + c.y * - 1 ) * - 1 if side < 0 else 0.035 - c.y * - 1, bz + c.z ) ) if False else Vector( ( c.x * ( 1 if side < 0 else - 1 ), ( - 0.035 + c.y ) if side < 0 else ( 0.035 - c.y ), bz + c.z ) ), 4 )
		nx, sq = 18, bw / 18
		for i in range( nx ):
			for j in range( 2 ):
				box( bm, ( - bw / 2 + sq * ( i + 0.5 ), side * 0.034, bz - 0.45 - sq * ( j + 0.5 ) ), ( sq, 0.012, sq ), 4 if ( i + j ) % 2 == 0 else 5 )
	box( bm, ( 0, 0, bz - 0.45 - sq ), ( bw, 0.05, sq * 2 ), 4 )
	for sx in ( - bw / 2 + 0.2, bw / 2 - 0.2 ):  # straps up to the tube
		box( bm, ( sx, 0, bz + 0.45 + 0.5 ), ( 0.08, 0.02, 1.0 ), 5 )
	bmesh.ops.recalc_face_normals( bm, faces = bm.faces )
	return obj_from_bm( 'Arch', bm, [ M[ 'blue' ], M[ 'white' ], M[ 'base' ], M[ 'blue' ], M[ 'inkw' ], M[ 'black' ] ] )

def ramp():
	bm = bmesh.new(); L, W = RAMP_L, RAMP_HW
	top = lambda s: RAMP_Y0 + ( RAMP_Y1 - RAMP_Y0 ) * s
	n = 16
	# side walls, back wall and the grippy top as one closed wedge (Blender -Y = run direction)
	def v( x, s, z ): return bm.verts.new( ( x, - L * s, z ) )
	TL = [ v( - W, i / n, top( i / n ) ) for i in range( n + 1 ) ]; TR = [ v( W, i / n, top( i / n ) ) for i in range( n + 1 ) ]
	BL = [ v( - W, i / n, RAMP_BOT ) for i in range( n + 1 ) ]; BR = [ v( W, i / n, RAMP_BOT ) for i in range( n + 1 ) ]
	for i in range( n ):
		bm.faces.new( ( TL[ i ], TR[ i ], TR[ i + 1 ], TL[ i + 1 ] ) ).material_index = 0
		bm.faces.new( ( BL[ i ], BL[ i + 1 ], BR[ i + 1 ], BR[ i ] ) ).material_index = 2
		bm.faces.new( ( BL[ i ], TL[ i ], TL[ i + 1 ], BL[ i + 1 ] ) ).material_index = 1
		bm.faces.new( ( BR[ i + 1 ], TR[ i + 1 ], TR[ i ], BR[ i ] ) ).material_index = 1
	bm.faces.new( ( BL[ n ], TL[ n ], TR[ n ], BR[ n ] ) ).material_index = 1
	bm.faces.new( ( BR[ 0 ], TR[ 0 ], TL[ 0 ], BL[ 0 ] ) ).material_index = 3
	# white foam float band at the waterline, proud of the shell
	box( bm, ( 0, - L / 2, - 0.1 ), ( 2 * W + 0.08, L + 0.02, 0.28 ), 2 )
	# bright bullnose edges along the top sides and the lip
	for sx in ( - W, W ):
		tube( bm, [ ( Vector( ( sx, - L * s, top( s ) + 0.01 ) ), Vector( ( 0, - L, RAMP_Y1 - RAMP_Y0 ) ) ) for s in ( 0.0, 1.0 ) ], 0.07, 12, 3 )
	tube( bm, [ ( Vector( ( x, - L + 0.02, RAMP_Y1 + 0.01 ) ), Vector( ( 1, 0, 0 ) ) ) for x in ( - W, W ) ], 0.075, 12, 3 )
	tube( bm, [ ( Vector( ( x, 0.0, RAMP_Y0 + 0.01 ) ), Vector( ( 1, 0, 0 ) ) ) for x in ( - W, W ) ], 0.06, 12, 3 )
	# transverse traction ribs (1 cm)
	for i in range( 1, 16 ):
		s = i / 16
		box( bm, ( 0, - L * s, top( s ) + 0.006 ), ( 2 * W - 0.2, 0.05, 0.012 ), 0 )
	# print on both side walls
	for sx in ( - 1, 1 ):
		t = text_mesh( 'TIDEWATER BAY', 0.22 )
		ang = math.atan2( RAMP_Y1 - RAMP_Y0, L ) * 0.5
		def f( c, sx = sx ):
			x, z = c.x, c.z
			return Vector( ( sx * ( W + 0.008 ), - ( L * 0.7 + x * - sx ), 0.22 + z ) )
		add_bm( bm, t, f, 4 )
	bmesh.ops.recalc_face_normals( bm, faces = bm.faces )
	return obj_from_bm( 'Ramp', bm, [ M[ 'deck' ], M[ 'hdpe' ], M[ 'foam' ], M[ 'edge' ], M[ 'ink' ] ] )

def line():
	# three-strand laid rope, 1 m down from the buoy (Course.js stretches it to the anchor)
	bm = bmesh.new(); S = 36
	for st in range( 3 ):
		path = []
		for i in range( S + 1 ):
			z = - 1.0 + i / S; a = 2 * math.pi * ( z / 0.07 ) + st * 2 * math.pi / 3
			p = Vector( ( 0.009 * math.cos( a ), 0.009 * math.sin( a ), z ) )
			t = Vector( ( - 0.009 * math.sin( a ) * 2 * math.pi / 0.07, 0.009 * math.cos( a ) * 2 * math.pi / 0.07, 1.0 ) )
			path.append( ( p, t ) )
		tube( bm, path, 0.0105, 6, 0 )
	return obj_from_bm( 'MooringLine', bm, [ M[ 'rope' ] ] )

def flash():
	bm = bmesh.new()
	lathe( bm, [ ( 0.52, 0.0 ), ( 0.5, 0.9 ), ( 0.46, 1.45 ), ( 0.34, 1.68 ), ( 0.02, 1.78 ) ], 32, 0 )
	return obj_from_bm( 'BuoyFlash', bm, [ M[ 'flash' ] ] )

objs = [ buoy( 'BuoyRed', ( 0.62, 0.035, 0.03 ), M[ 'inkw' ] ), buoy( 'BuoyYellow', ( 0.86, 0.56, 0.03 ), M[ 'ink' ] ), buoy( 'BuoyTurn', ( 0.86, 0.56, 0.03 ), M[ 'ink' ], h = 3.0, rb = 0.8, n = 56 ), arch(), ramp(), line(), flash() ]
for i, o in enumerate( objs ): o.location.x = i * 20  # spread for a preview; Course.js resets every position
tris = 0
for o in objs:
	o.data.calc_loop_triangles(); tris += len( o.data.loop_triangles ); print( 'OBJ', o.name, len( o.data.loop_triangles ), 'tris', [ round( v, 2 ) for v in o.dimensions ] )
print( 'TOTAL tris', tris )
os.makedirs( os.path.dirname( OUT ), exist_ok = True )
bpy.ops.export_scene.gltf( filepath = os.path.abspath( OUT ), export_format = 'GLB', export_apply = True, export_yup = True )
print( 'WROTE', os.path.abspath( OUT ), os.path.getsize( OUT ) )
