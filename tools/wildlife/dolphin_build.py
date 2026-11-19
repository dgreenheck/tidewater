# Common bottlenose dolphin (Tursiops truncatus) generator.
#
# Anatomy table (fractions of total length, TL, from the tip of the rostrum) -> parametric lofts
# (fusiform body with melon and rostrum, falcate dorsal fin, pectoral flippers, notched flukes),
# three levels of detail, a baked 2048x1024 skin (albedo + roughness in alpha, 16-bit relief in R/G)
# and review renders in Cycles. Output layout matches public/models/whale (see Whale.js).
#
#   blender --background --factory-startup \
#     --python tools/wildlife/dolphin_build.py -- <scratch dir> [--no-render] [--refs 6,10,9]
#
# Rest frame: +Z toward the snout, +Y up, +X the animal's left; z = 0 at ROOT_S (rig root).

import bpy, sys, os, json, math, struct, zlib
import numpy as np

HERE = os.path.dirname( os.path.abspath( __file__ ) )
REPO = os.path.dirname( os.path.dirname( HERE ) )
OUT = os.path.join( REPO, 'public', 'models', 'dolphin' )
argv = sys.argv[ sys.argv.index( '--' ) + 1: ] if '--' in sys.argv else []
SCR = argv[ 0 ] if argv and not argv[ 0 ].startswith( '--' ) else '/tmp'
RENDER = '--no-render' not in argv
REFS = [ int( r ) for r in argv[ argv.index( '--refs' ) + 1 ].split( ',' ) ] if '--refs' in argv else [ 12, 5, 4 ]
os.makedirs( OUT, exist_ok = True )

TL = 2.90       # m, adult (2.5 to 3.5 m)
ROOT_S = 0.38   # rig root (z = 0): near the centre of mass, behind the flippers

# ---------------------------------------------------------------- anatomy table (TL units)
# s: distance from the rostrum tip / TL; top / bot: dorsal / ventral outline above / below the
# trunk axis; hw: half width. Landmarks: beak-melon crease 0.050, gape corner 0.105, eye 0.116,
# blowhole 0.140, flipper insertion 0.215, max girth 0.36 (girth ~0.57 TL), dorsal fin 0.45-0.61
# (blowhole to fin = 0.31 TL: TL = 5.06 + 3.17 BH-DF), anus 0.69, fluke insertion 0.868, notch 1.0.
PROFILE = np.array( [
	# s      top      bot      hw
	[ 0.000,  0.001, -0.014, 0.0055 ],
	[ 0.010,  0.006, -0.019, 0.0115 ],
	[ 0.025,  0.011, -0.025, 0.0160 ],
	[ 0.042,  0.016, -0.031, 0.0220 ],
	[ 0.050,  0.019, -0.034, 0.0260 ],
	[ 0.060,  0.033, -0.038, 0.0330 ],
	[ 0.072,  0.051, -0.043, 0.0410 ],
	[ 0.088,  0.066, -0.050, 0.0510 ],
	[ 0.108,  0.077, -0.058, 0.0600 ],
	[ 0.140,  0.086, -0.068, 0.0680 ],
	[ 0.175,  0.090, -0.076, 0.0700 ],
	[ 0.220,  0.094, -0.084, 0.0760 ],
	[ 0.290,  0.098, -0.090, 0.0830 ],
	[ 0.360,  0.100, -0.092, 0.0840 ],
	[ 0.430,  0.098, -0.089, 0.0800 ],
	[ 0.500,  0.091, -0.082, 0.0710 ],
	[ 0.580,  0.079, -0.070, 0.0570 ],
	[ 0.650,  0.065, -0.057, 0.0420 ],
	[ 0.720,  0.054, -0.048, 0.0270 ],
	[ 0.800,  0.043, -0.036, 0.0165 ],
	[ 0.860,  0.033, -0.026, 0.0115 ],
	[ 0.900,  0.023, -0.018, 0.0090 ],
	[ 0.940,  0.013, -0.011, 0.0075 ],
	[ 0.975,  0.007, -0.006, 0.0060 ],
	[ 1.000,  0.003, -0.003, 0.0040 ],
] )
# superellipse exponent of the cross section: rounded head, fuller trunk, keeled tail stock
NEXP = np.array( [ [ 0, 2.0 ], [ 0.05, 2.1 ], [ 0.3, 2.25 ], [ 0.6, 2.2 ], [ 0.72, 1.9 ], [ 0.85, 1.6 ], [ 1.0, 1.7 ] ] )
S_GAPE, S_EYE, S_BLOW, S_FLIP = 0.105, 0.116, 0.140, 0.215
FIN_H = 0.092       # dorsal fin height above the back
FLUKE_HALF = 0.117  # half span (span 0.234 TL)


def pchip( xs, ys, x ):

	xs = np.asarray( xs, float ); ys = np.asarray( ys, float ); x = np.asarray( x, float )
	h = np.diff( xs ); d = np.diff( ys ) / h
	m = np.zeros_like( ys )
	for k in range( 1, len( xs ) - 1 ):
		if d[ k - 1 ] * d[ k ] > 0:
			w1 = 2 * h[ k ] + h[ k - 1 ]; w2 = h[ k ] + 2 * h[ k - 1 ]
			m[ k ] = ( w1 + w2 ) / ( w1 / d[ k - 1 ] + w2 / d[ k ] )
	m[ 0 ] = d[ 0 ]; m[ -1 ] = d[ -1 ]
	i = np.clip( np.searchsorted( xs, x ) - 1, 0, len( xs ) - 2 )
	t = np.clip( ( x - xs[ i ] ) / h[ i ], 0, 1 )
	return ( 2 * t ** 3 - 3 * t ** 2 + 1 ) * ys[ i ] + ( t ** 3 - 2 * t ** 2 + t ) * h[ i ] * m[ i ] + ( - 2 * t ** 3 + 3 * t ** 2 ) * ys[ i + 1 ] + ( t ** 3 - t ** 2 ) * h[ i ] * m[ i + 1 ]


def prof( s ):

	return ( pchip( PROFILE[ :, 0 ], PROFILE[ :, 1 ], s ), pchip( PROFILE[ :, 0 ], PROFILE[ :, 2 ], s ),
		pchip( PROFILE[ :, 0 ], PROFILE[ :, 3 ], s ), np.interp( s, NEXP[ :, 0 ], NEXP[ :, 1 ] ) )


def section( s, ph ):

	# ph: 0 ventral midline, pi/2 left (+x), pi dorsal
	top, bot, hw, ne = prof( s )
	c = - np.cos( ph ); sn = np.sin( ph ); e = 2.0 / ne
	x = hw * np.sign( sn ) * np.abs( sn ) ** e
	yn = np.sign( c ) * np.abs( c ) ** e
	y = np.where( c >= 0, top, - bot ) * yn
	return x, y, yn


def gape_y( s ):

	return - 0.0075 + 0.0035 * np.clip( s / S_GAPE, 0, 1 ) ** 2


def side_x( s, y ):

	top, bot, hw, ne = prof( s )
	r = abs( y / ( top if y > 0 else - bot ) )
	return float( hw * max( 0.0, 1 - r ** ne ) ** ( 1 / ne ) )


def bez2( p0, p1, p2, t ):

	t = np.asarray( t )[ :, None ]
	return ( 1 - t ) ** 2 * np.array( p0 ) + 2 * ( 1 - t ) * t * np.array( p1 ) + t ** 2 * np.array( p2 )


def bez3( p0, p1, p2, p3, t ):

	t = np.asarray( t )[ :, None ]
	return ( 1 - t ) ** 3 * np.array( p0 ) + 3 * ( 1 - t ) ** 2 * t * np.array( p1 ) + 3 * ( 1 - t ) * t ** 2 * np.array( p2 ) + t ** 3 * np.array( p3 )


# ---------------------------------------------------------------- mesh parts

class Part:

	def __init__( self ):

		self.P = []; self.UV = []; self.UV1 = []; self.RIG = []; self.T = []; self.N = []; self.n = 0; self.fallback = []

	def add( self, P, UV, UV1, RIG, T, fb ):

		self.P.append( P ); self.UV.append( UV ); self.UV1.append( UV1 ); self.RIG.append( RIG ); self.fallback.append( fb )
		# normals per surface: the two faces of a thin foil meet at zero thickness (tips, trailing
		# edge) and must not be averaged into each other
		self.N.append( normals( P, T, fb ) )
		self.T.append( T + self.n ); self.n += len( P )

	def arrays( self ):

		P = np.concatenate( self.P ); T = np.concatenate( self.T )
		return P, np.concatenate( self.UV ), np.concatenate( self.UV1 ), np.concatenate( self.RIG ), T, np.concatenate( self.fallback ), np.concatenate( self.N )


def grid_tris( nr, nc, closed = False ):

	cols = nc if closed else nc - 1
	i, j = np.meshgrid( np.arange( nr - 1 ), np.arange( cols ), indexing = 'ij' )
	a = i * nc + j; b = i * nc + ( j + 1 ) % nc; c = ( i + 1 ) * nc + j; d = ( i + 1 ) * nc + ( j + 1 ) % nc
	return np.concatenate( [ np.stack( [ a, c, b ], -1 ).reshape( -1, 3 ), np.stack( [ b, c, d ], -1 ).reshape( -1, 3 ) ] )


def orient( P, T, outward ):

	fn = np.cross( P[ T[ :, 1 ] ] - P[ T[ :, 0 ] ], P[ T[ :, 2 ] ] - P[ T[ :, 0 ] ] )
	if np.sum( np.einsum( 'ij,ij->i', fn, outward[ T[ :, 0 ] ] ) ) < 0: T = T[ :, [ 0, 2, 1 ] ]
	return T


def normals( P, T, fb ):

	fn = np.cross( P[ T[ :, 1 ] ] - P[ T[ :, 0 ] ], P[ T[ :, 2 ] ] - P[ T[ :, 0 ] ] )
	_, inv = np.unique( np.round( P / 2e-5 ).astype( np.int64 ), axis = 0, return_inverse = True )
	inv = inv.ravel()
	acc = np.zeros( ( inv.max() + 1, 3 ) )
	for c in range( 3 ): np.add.at( acc, inv[ T[ :, c ] ], fn )
	N = acc[ inv ]; ln = np.linalg.norm( N, axis = 1 ); bad = ln < 1e-14
	N[ ~ bad ] /= ln[ ~ bad, None ]; N[ bad ] = fb[ bad ]
	return N


REGION = { 'fin': 0, 'flipL': 1, 'flipR': 2, 'fluke': 3 }


def region_uv( name, xc, t, upper ):

	u = ( REGION[ name ] + 0.15 + 0.7 * xc ) * 0.25
	v = 0.75 + ( ( 0.0 if upper else 0.5 ) + ( 0.25 + 0.5 * t ) * 0.5 ) * 0.25
	return u, v


def body( ns, nt ):

	u = np.linspace( 0, 1, ns ); s = 0.5 - 0.5 * np.cos( np.pi * u )
	ph = np.linspace( 0, 2 * np.pi, nt + 1 )
	S, PH = np.meshgrid( s, ph, indexing = 'ij' )
	x, y, yn = section( S, PH )
	top, bot, hw, ne = prof( s )
	yc = ( ( top + bot ) / 2 )[ :, None ] * np.ones_like( S )
	P = np.stack( [ x, y, ROOT_S - S ], -1 ).reshape( -1, 3 ) * TL
	out = np.stack( [ x, y - yc, np.zeros_like( x ) ], -1 ).reshape( -1, 3 )
	UV = np.stack( [ S, PH / ( 2 * np.pi ) * 0.75 ], -1 ).reshape( -1, 2 )
	UV1 = np.stack( [ S, PH / ( 2 * np.pi ) ], -1 ).reshape( -1, 2 )
	T = grid_tris( ns, nt + 1 )
	# caps: rostrum tip and tail end
	nb = ns * ( nt + 1 )
	tip = np.array( [ [ 0, ( top[ 0 ] + bot[ 0 ] ) / 2 * TL, ( ROOT_S + 0.0015 ) * TL ], [ 0, ( top[ -1 ] + bot[ -1 ] ) / 2 * TL, ( ROOT_S - 1.0015 ) * TL ] ] )
	P = np.concatenate( [ P, tip ] )
	out = np.concatenate( [ out, [ [ 0, 0, 1 ], [ 0, 0, - 1 ] ] ] )
	UV = np.concatenate( [ UV, [ [ 0.0, 0.375 ], [ 1.0, 0.375 ] ] ] ); UV1 = np.concatenate( [ UV1, [ [ 0, 0.5 ], [ 1, 0.5 ] ] ] )
	j = np.arange( nt )
	cap0 = np.stack( [ np.full( nt, nb ), j + 1, j ], -1 )
	last = ( ns - 1 ) * ( nt + 1 )
	cap1 = np.stack( [ np.full( nt, nb + 1 ), last + j, last + j + 1 ], -1 )
	T = np.concatenate( [ T, cap0, cap1 ] )
	T = orient( P, T, out )
	RIG = np.stack( [ P[ :, 2 ], np.zeros( len( P ) ), np.zeros( len( P ) ), np.zeros( len( P ) ) ], -1 )
	return P, UV, UV1, RIG, T, out


def foil( part, name, le, te, tmax, nrm, nc, span_t, rig_x, part_id ):

	# le, te: (nsec, 3) leading / trailing edge points (m); tmax: (nsec,) max thickness (m);
	# nrm: (3,) or (nsec, 3) thickness direction. Two surfaces (upper = +nrm) sharing edges.
	nsec = len( le )
	nrm = np.broadcast_to( np.asarray( nrm, float ), ( nsec, 3 ) )
	beta = np.linspace( 0, np.pi, nc ); xc = 0.5 * ( 1 - np.cos( beta ) )
	g = ( 0.2969 * np.sqrt( xc ) - 0.1260 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1036 * xc ** 4 ) / 0.1
	g = np.maximum( g, 0 )
	for upper in ( True, False ):
		sg = 1.0 if upper else - 1.0
		P = le[ :, None, : ] + ( te - le )[ :, None, : ] * xc[ None, :, None ] + sg * ( 0.5 * tmax[ :, None ] * g[ None, : ] )[ ..., None ] * nrm[ :, None, : ]
		P = P.reshape( -1, 3 )
		XC, TT = np.meshgrid( xc, span_t )
		u, v = region_uv( name, XC.ravel(), TT.ravel(), upper )
		UV = np.stack( [ u, v ], -1 ); UV1 = np.stack( [ XC.ravel(), TT.ravel() ], -1 )
		T = grid_tris( nsec, nc )
		out = np.repeat( sg * nrm, nc, axis = 0 )
		T = orient( P, T, out )
		rx = rig_x( P )
		RIG = np.stack( [ rx, np.full( len( P ), part_id ), TT.ravel(), np.zeros( len( P ) ) ], -1 )
		part.add( P, UV, UV1, RIG, T, out )


def dorsal_fin( part, nsec, nc ):

	t = np.linspace( 0, 1, nsec ) ** 0.85
	LE = bez2( [ 0.448, - 0.12 ], [ 0.505, 0.80 ], [ 0.592, 1.0 ], t )
	TE = bez2( [ 0.612, - 0.12 ], [ 0.548, 0.50 ], [ 0.592, 1.0 ], t )
	def to3( sh ):
		top = prof( sh[ :, 0 ] )[ 0 ]
		return np.stack( [ np.zeros( len( sh ) ), ( top + sh[ :, 1 ] * FIN_H ), ROOT_S - sh[ :, 0 ] ], -1 ) * TL
	h = np.maximum( LE[ :, 1 ], 0 )
	tmax = ( 0.0155 * ( 1 - t ) ** 0.9 + 0.026 * np.exp( - h / 0.07 ) * ( 1 - t ) ) * TL
	foil( part, 'fin', to3( LE ), to3( TE ), tmax, [ 1, 0, 0 ], nc, t, lambda P: P[ :, 2 ], 0 )


def flipper( part, side, nsec, nc ):

	sg = 1.0 if side == 0 else - 1.0
	yr = - 0.040
	root = np.array( [ sg * ( side_x( S_FLIP, yr ) - 0.006 ), yr, ROOT_S - S_FLIP ] )
	A = np.array( [ 0, - 0.25, - 1.0 ] ); A /= np.linalg.norm( A )
	B = np.array( [ sg * 0.82, - 0.57, 0 ] ); B /= np.linalg.norm( B )
	N = np.cross( A, B ); N *= np.sign( N[ 1 ] ) or 1.0
	t = np.linspace( 0, 1, nsec ) ** 0.9
	LE = bez2( [ 0.0, - 0.012 ], [ 0.020, 0.075 ], [ 0.100, 0.105 ], t )
	TE = bez2( [ 0.058, - 0.014 ], [ 0.070, 0.050 ], [ 0.100, 0.105 ], t )
	to3 = lambda ab: ( root[ None, : ] + ab[ :, :1 ] * A[ None, : ] + ab[ :, 1: ] * B[ None, : ] ) * TL
	tmax = ( 0.0165 * ( 1 - t ) ** 0.8 ) * TL
	rz = root[ 2 ] * TL
	foil( part, 'flipL' if side == 0 else 'flipR', to3( LE ), to3( TE ), tmax, N, nc, t, lambda P: np.full( len( P ), rz ), 1 + side )
	return root * TL, np.array( [ A, B, N ] )


def flukes( part, nsec, nc ):

	v = np.linspace( - np.pi / 2, np.pi / 2, nsec ); xs = FLUKE_HALF * np.sin( v )
	tt = np.linspace( 0, 1, 600 )
	le = bez2( [ 0, 0.862 ], [ 0.072, 0.880 ], [ FLUKE_HALF, 1.004 ], tt )
	te = bez3( [ 0, 0.998 ], [ 0.030, 1.018 ], [ 0.075, 0.972 ], [ FLUKE_HALF, 1.004 ], tt )
	ax = np.abs( xs )
	sle = np.interp( ax, le[ :, 0 ], le[ :, 1 ] ); ste = np.interp( ax, te[ :, 0 ], te[ :, 1 ] )
	top, bot, _, _ = prof( np.array( [ 0.93 ] ) )
	yc = float( ( top + bot )[ 0 ] / 2 )
	LE = np.stack( [ xs, np.full( nsec, yc ), ROOT_S - sle ], -1 ) * TL
	TE = np.stack( [ xs, np.full( nsec, yc ), ROOT_S - ste ], -1 ) * TL
	tmax = ( 0.021 * np.clip( 1 - ax / FLUKE_HALF, 0, 1 ) ** 1.1 ) * TL
	foil( part, 'fluke', LE, TE, tmax, [ 0, 1, 0 ], nc, ( xs / FLUKE_HALF + 1 ) / 2, lambda P: P[ :, 2 ], 0 )


LODS = [ ( 'lod0', 92, 48, 16, 14, 13, 12, 30, 14 ), ( 'lod1', 46, 26, 8, 8, 7, 7, 14, 8 ), ( 'lod2', 22, 12, 4, 5, 4, 4, 7, 5 ) ]


def build_level( spec ):

	name, ns, nt, fs, fc, ps, pc, ks, kc = spec
	parts = []
	b = Part(); b.add( *body( ns, nt ) ); parts.append( b )
	f = Part(); dorsal_fin( f, fs, fc ); parts.append( f )
	pec = []
	for side in ( 0, 1 ):
		p = Part(); pec.append( flipper( p, side, ps, pc ) ); parts.append( p )
	k = Part(); flukes( k, ks, kc ); parts.append( k )
	Ps, Ns, UVs, UV1s, RIGs, Ts = [], [], [], [], [], []
	n0 = 0
	for p in parts:
		P, UV, UV1, RIG, T, fb, N = p.arrays()
		Ps.append( P ); Ns.append( N ); UVs.append( UV ); UV1s.append( UV1 ); RIGs.append( RIG ); Ts.append( T + n0 ); n0 += len( P )
	return dict( name = name, P = np.concatenate( Ps ), N = np.concatenate( Ns ), UV = np.concatenate( UVs ), UV1 = np.concatenate( UV1s ),
		RIG = np.concatenate( RIGs ), T = np.concatenate( Ts ), pec = pec, bodyTris = len( Ts[ 0 ] ), bodyP = Ps[ 0 ], bodyT = Ts[ 0 ] )


# ---------------------------------------------------------------- skin

W, H, HB = 2048, 1024, 768


def smooth( e0, e1, x ):

	t = np.clip( ( x - e0 ) / ( e1 - e0 ), 0, 1 )
	return t * t * ( 3 - 2 * t )


def value_noise( rng, shape, cells ):

	gh, gw = cells
	G = rng.random( ( gh + 2, gw + 2 ) )
	yy = np.linspace( 0, gh, shape[ 0 ] ); xx = np.linspace( 0, gw, shape[ 1 ] )
	y0 = np.floor( yy ).astype( int ); x0 = np.floor( xx ).astype( int )
	ty = ( yy - y0 )[ :, None ]; tx = ( xx - x0 )[ None, : ]
	ty = ty * ty * ( 3 - 2 * ty ); tx = tx * tx * ( 3 - 2 * tx )
	a = G[ y0[ :, None ], x0[ None, : ] ]; b = G[ y0[ :, None ], x0[ None, : ] + 1 ]
	c = G[ y0[ :, None ] + 1, x0[ None, : ] ]; d = G[ y0[ :, None ] + 1, x0[ None, : ] + 1 ]
	return ( a * ( 1 - tx ) + b * tx ) * ( 1 - ty ) + ( c * ( 1 - tx ) + d * tx ) * ty


def seg_dist( px, py, ax, ay, bx, by ):

	dx, dy = bx - ax, by - ay
	t = np.clip( ( ( px - ax ) * dx + ( py - ay ) * dy ) / ( dx * dx + dy * dy ), 0, 1 )
	return np.hypot( px - ( ax + t * dx ), py - ( ay + t * dy ) ), t


def mix( a, b, w ):

	return a + ( np.asarray( b ) - a ) * w[ ..., None ]


def skin():

	rng = np.random.default_rng( 7 )
	s = ( np.arange( W ) + 0.5 ) / W
	ph = ( np.arange( HB ) + 0.5 ) / HB * 2 * np.pi
	S, PH = np.meshgrid( s, ph )
	X, Y, YN = section( S, PH )
	top, bot, hw, ne = prof( s )
	sideW = np.abs( np.sin( PH ) )
	# ---- countershading: dark cape, grey flank, pale flank blaze, white belly and throat
	cape_line = np.interp( S, [ 0, 0.055, 0.07, 0.10, 0.15, 0.25, 0.38, 0.50, 0.60, 0.70, 0.80, 0.90, 1.0 ], [ 2, 2, 0.75, 0.45, 0.30, 0.32, 0.24, 0.08, 0.12, 0.05, - 0.15, - 0.40, - 0.50 ] )
	belly_line = np.interp( S, [ 0, 0.10, 0.14, 0.20, 0.30, 0.42, 0.55, 0.66, 0.75, 0.84, 0.92, 1.0 ], [ - 0.2, - 0.25, - 0.2, - 0.28, - 0.33, - 0.38, - 0.45, - 0.58, - 0.72, - 0.90, - 1.1, - 1.1 ] )
	cape = smooth( cape_line - 0.14, cape_line + 0.14, YN )
	pale_body = 1 - smooth( belly_line - 0.09, belly_line + 0.09, YN )
	gy = gape_y( S )
	pale_head = 1 - smooth( gy - 0.006, gy + 0.001, Y )
	pale = np.where( S < 0.10, pale_head, pale_body )
	wb = smooth( 0.10, 0.13, S ); pale = pale_head * ( 1 - wb ) + pale_body * wb
	pale *= 1 - 0.35 * smooth( 0.0, 0.02, 0.02 - S )  # rostrum tip a little greyer
	col = np.zeros( S.shape + ( 3, ) ) + np.array( [ 0.285, 0.30, 0.315 ] )
	col = mix( col, [ 0.25, 0.265, 0.28 ], smooth( 0.07, 0.03, S ) * ( 1 - pale ) )  # beak
	d, t = seg_dist( S * 4, YN, 0.40 * 4, - 0.30, 0.63 * 4, 0.22 )
	blaze = np.exp( - ( d / ( 0.17 * ( 1 - 0.5 * t ) ) ) ** 2 ) * smooth( 0, 0.15, t ) * ( 1 - smooth( 0.85, 1.0, t ) )
	col = mix( col, [ 0.43, 0.445, 0.455 ], 0.6 * blaze )
	col = mix( col, [ 0.145, 0.155, 0.165 ], cape * ( 1 - 0.5 * blaze ) )
	belly = np.zeros_like( col ) + np.array( [ 0.74, 0.735, 0.72 ] )
	belly = mix( belly, [ 0.78, 0.68, 0.66 ], 0.35 * smooth( 0.52, 0.6, S ) * smooth( 0.74, 0.66, S ) * smooth( - 0.7, - 0.9, YN ) )
	col = mix( col, belly, pale )
	Hm = np.zeros( S.shape )
	rough = np.full( S.shape, 0.40 ) + 0.03 * pale
	dark = np.zeros( S.shape )
	sm = ( S - 0 ) * TL; ym = Y * TL
	# ---- head: gape line, eye, stripes, crease, blowhole
	g_d = np.abs( ym - gy * TL )
	gmask = smooth( 0.003, 0.012, S ) * smooth( S_GAPE + 0.003, S_GAPE - 0.004, S ) * smooth( 0.1, 0.3, sideW )
	dark = np.maximum( dark, 0.55 * np.exp( - ( g_d / 0.0018 ) ** 2 ) * gmask )
	Hm -= 0.0025 * np.exp( - ( g_d / 0.0016 ) ** 2 ) * gmask
	er = np.hypot( ( S - S_EYE ) * TL, ( Y - 0.0 ) * TL / 0.72 )
	emask = smooth( 0.35, 0.6, sideW )
	dark = np.maximum( dark, 0.35 * np.exp( - ( er / 0.045 ) ** 2 ) * emask )
	ds1, _ = seg_dist( sm, ym, S_EYE * TL, - 0.002 * TL, S_FLIP * TL, - 0.042 * TL )
	dark = np.maximum( dark, 0.28 * np.exp( - ( ds1 / 0.011 ) ** 2 ) * emask * smooth( S_FLIP + 0.01, S_FLIP - 0.02, S ) )
	ds2, _ = seg_dist( sm, ym, 0.11 * TL, 0.004 * TL, 0.062 * TL, 0.024 * TL )
	dark = np.maximum( dark, 0.18 * np.exp( - ( ds2 / 0.008 ) ** 2 ) * smooth( 0.2, 0.5, sideW ) )
	Hm -= 0.0016 * np.exp( - ( ( S - 0.0505 ) * TL / 0.006 ) ** 2 ) * smooth( - 0.2, 0.2, YN )
	eye = smooth( 0.0165, 0.0135, er ) * emask
	Hm += 0.0016 * eye * np.sqrt( np.clip( 1 - ( er / 0.0165 ) ** 2, 0, 1 ) ) - 0.001 * np.exp( - ( ( er - 0.019 ) / 0.0025 ) ** 2 ) * emask
	fwd = - ( S - S_BLOW ) * TL; bx = X * TL
	cr = np.abs( np.hypot( fwd - 0.018, bx ) - 0.026 )
	blow = np.exp( - ( cr / 0.0022 ) ** 2 ) * ( fwd < 0.012 ) * ( np.abs( bx ) < 0.02 ) * smooth( 0.85, 0.95, YN )
	dark = np.maximum( dark, 0.75 * blow ); Hm -= 0.006 * blow
	# ---- ventral: navel, genital slit, anus
	vmask = smooth( - 0.9, - 0.98, YN )
	slit = np.exp( - ( bx / 0.0022 ) ** 2 ) * smooth( 0.598, 0.605, S ) * smooth( 0.647, 0.64, S ) * vmask
	anus = np.exp( - ( np.hypot( bx, ( S - 0.69 ) * TL / 2.5 ) / 0.004 ) ** 2 ) * vmask
	navel = np.exp( - ( np.hypot( bx, ( S - 0.505 ) * TL ) / 0.006 ) ** 2 ) * vmask
	for f, a in ( ( slit, 0.45 ), ( anus, 0.45 ), ( navel, 0.2 ) ):
		col = mix( col, [ 0.55, 0.46, 0.46 ], a * f ); Hm -= 0.002 * f
	# ---- rake marks (tooth rakes from other dolphins): groups of pale parallel lines
	scar = np.zeros( S.shape )
	for g in range( 16 ):
		s0 = rng.uniform( 0.14, 0.82 ); p0 = rng.uniform( 0.3, 1.7 ) * np.pi
		ang = rng.uniform( - 0.7, 0.7 ) + ( np.pi / 2 if rng.random() < 0.6 else 0 )
		k = int( rng.integers( 2, 6 ) ); L = rng.uniform( 0.10, 0.28 ); sp = rng.uniform( 0.008, 0.014 ); wd = rng.uniform( 0.0007, 0.0011 )
		strength = rng.uniform( 0.2, 0.5 )
		tp, bt, hw0, _ = prof( np.array( [ s0 ] ) ); rr = float( 0.5 * ( hw0 + ( tp - bt ) / 2 ) ) * TL
		c0 = max( 0, int( ( s0 - ( L + 0.05 ) / TL ) * W ) ); c1 = min( W, int( ( s0 + ( L + 0.05 ) / TL ) * W ) + 1 )
		dp = ( L + 0.05 ) / rr
		r0 = max( 0, int( ( p0 - dp ) / ( 2 * np.pi ) * HB ) ); r1 = min( HB, int( ( p0 + dp ) / ( 2 * np.pi ) * HB ) + 1 )
		a = ( S[ r0:r1, c0:c1 ] - s0 ) * TL; b = ( PH[ r0:r1, c0:c1 ] - p0 ) * rr
		ca, sa = math.cos( ang ), math.sin( ang )
		u = a * ca + b * sa; w = - a * sa + b * ca
		acc = np.zeros( a.shape )
		for j in range( k ):
			off = ( j - ( k - 1 ) / 2 ) * sp + rng.normal( 0, 0.0015 )
			lj = L * rng.uniform( 0.6, 1.0 )
			wiggle = 0.002 * np.sin( u * rng.uniform( 40, 90 ) + rng.uniform( 0, 6 ) )
			line = np.exp( - ( ( w - off - wiggle ) / wd ) ** 2 ) * smooth( lj / 2, lj / 2 - 0.01, np.abs( u ) )
			acc = np.maximum( acc, line )
		scar[ r0:r1, c0:c1 ] = np.maximum( scar[ r0:r1, c0:c1 ], strength * acc )
	for i in range( 5 ):  # healed blotches
		s0 = rng.uniform( 0.2, 0.75 ); p0 = rng.uniform( 0.4, 1.6 ) * np.pi
		r = np.hypot( ( S - s0 ) * TL, ( PH - p0 ) * 0.22 )
		scar = np.maximum( scar, 0.35 * smooth( 0.02, 0.006, r ) * value_noise( rng, S.shape, ( 90, 240 ) ) )
	col = mix( col, [ 0.46, 0.47, 0.48 ], 0.5 * scar * ( 1 - pale ) )
	Hm -= 0.0004 * scar; rough += 0.08 * scar
	# ---- mottling and fine skin tone variation
	n1 = value_noise( rng, S.shape, ( 10, 40 ) ); n2 = value_noise( rng, S.shape, ( 60, 220 ) ); n3 = value_noise( rng, S.shape, ( 200, 700 ) )
	lum = 1 + 0.07 * ( n1 - 0.5 ) + 0.035 * ( n2 - 0.5 ) + 0.02 * ( n3 - 0.5 )
	col *= lum[ ..., None ]
	col *= ( 1 - dark )[ ..., None ]
	col = mix( col, [ 0.03, 0.035, 0.04 ], eye )
	rough = np.where( eye > 0.5, 0.12, rough )
	Hm += 0.00025 * ( n2 - 0.5 ) + 0.0001 * ( n3 - 0.5 )
	# ---- appendages (rows HB..H): fin, flippers, flukes; upper / lower halves
	A = np.zeros( ( H - HB, W, 3 ) ); RA = np.full( ( H - HB, W ), 0.42 )
	ry, rx = np.meshgrid( ( np.arange( H - HB ) + 0.5 ) / ( H - HB ), ( np.arange( W ) + 0.5 ) / W, indexing = 'ij' )
	reg = np.floor( rx * 4 ).astype( int ); xc = np.clip( ( rx * 4 - reg - 0.15 ) / 0.7, 0, 1 )
	upper = ry < 0.5; tt = np.clip( ( np.where( upper, ry, ry - 0.5 ) * 2 - 0.25 ) / 0.5, 0, 1 )
	edge = np.maximum( smooth( 0.25, 0.0, xc ), smooth( 0.75, 1.0, xc ) )
	na = value_noise( rng, ( H - HB, W ), ( 12, 60 ) )
	fin = np.array( [ 0.135, 0.145, 0.155 ] ) * ( 1 - 0.12 * tt[ ..., None ] )
	flip_up = np.array( [ 0.17, 0.18, 0.19 ] ) * np.ones_like( A )
	flip_lo = mix( np.array( [ 0.34, 0.35, 0.36 ] ) * np.ones_like( A ), [ 0.2, 0.21, 0.22 ], 0.6 * edge )
	fl_up = np.array( [ 0.15, 0.16, 0.17 ] ) * np.ones_like( A )
	fl_lo = mix( np.array( [ 0.40, 0.41, 0.42 ] ) * np.ones_like( A ), [ 0.2, 0.21, 0.22 ], 0.7 * np.maximum( edge, smooth( 0.35, 0.1, np.minimum( tt, 1 - tt ) ) ) )
	A = np.where( ( reg == 0 )[ ..., None ], fin * np.ones_like( A ), A )
	A = np.where( ( ( reg == 1 ) | ( reg == 2 ) )[ ..., None ], np.where( upper[ ..., None ], flip_up, flip_lo ), A )
	A = np.where( ( reg == 3 )[ ..., None ], np.where( upper[ ..., None ], fl_up, fl_lo ), A )
	A *= ( 1 + 0.06 * ( na - 0.5 ) )[ ..., None ]
	albedo = np.concatenate( [ col, A ] )
	rough = np.concatenate( [ rough, RA ] )
	Hm = np.concatenate( [ Hm, np.zeros( ( H - HB, W ) ) ] )
	return albedo, rough, Hm


def write_png( path, rgba ):

	h, w, _ = rgba.shape
	raw = np.zeros( ( h, 1 + w * 4 ), np.uint8 ); raw[ :, 1: ] = rgba.reshape( h, - 1 )
	def chunk( t, d ):
		return struct.pack( '>I', len( d ) ) + t + d + struct.pack( '>I', zlib.crc32( t + d ) & 0xffffffff )
	with open( path, 'wb' ) as f:
		f.write( b'\x89PNG\r\n\x1a\n' + chunk( b'IHDR', struct.pack( '>IIBBBBB', w, h, 8, 6, 0, 0, 0 ) ) + chunk( b'IDAT', zlib.compress( raw.tobytes(), 9 ) ) + chunk( b'IEND', b'' ) )


# ---------------------------------------------------------------- bake

levels = [ build_level( spec ) for spec in LODS ]
blob = bytearray(); lv_out = []
def put( arr ):
	global blob
	while len( blob ) % 4: blob.append( 0 )
	off = len( blob ); blob += arr.tobytes(); return off
for L in levels:
	P = L[ 'P' ].astype( np.float32 ); N = np.clip( np.round( L[ 'N' ] * 32767 ), - 32767, 32767 ).astype( np.int16 )
	lv_out.append( dict( name = L[ 'name' ], vertices = len( P ), indices = int( L[ 'T' ].size ),
		position = put( P ), normal = put( N ), uv = put( L[ 'UV' ].astype( np.float32 ) ), uv1 = put( L[ 'UV1' ].astype( np.float32 ) ),
		rig = put( L[ 'RIG' ].astype( np.float32 ) ), index = put( L[ 'T' ].astype( np.uint32 ).ravel() ) ) )
with open( os.path.join( OUT, 'bottlenose.bin' ), 'wb' ) as f: f.write( blob )

albedo, rough, Hm = skin()
a8 = np.concatenate( [ np.clip( albedo, 0, 1 ), rough[ ..., None ] ], -1 )
write_png( os.path.join( OUT, 'bottlenose_albedo.png' ), np.round( a8 * 255 ).astype( np.uint8 ) )
h0, h1 = float( Hm.min() ), float( Hm.max() )
v16 = np.round( ( Hm - h0 ) / ( h1 - h0 ) * 65535 ).astype( np.uint32 )
hr = np.stack( [ v16 >> 8, v16 & 255, v16 >> 8, np.full_like( v16, 255 ) ], -1 ).astype( np.uint8 )
write_png( os.path.join( OUT, 'bottlenose_height.png' ), hr )

cs = np.linspace( 0, 1, 41 ); top, bot, _, _ = prof( cs )
pec = levels[ 0 ][ 'pec' ]
manifest = dict( version = 1, species = 'Tursiops truncatus', length = TL, levels = lv_out,
	centerline = dict( z = [ round( float( ( ROOT_S - s ) * TL ), 5 ) for s in cs ], y = [ round( float( ( t + b ) / 2 * TL ), 5 ) for t, b in zip( top, bot ) ] ),
	snoutZ = ROOT_S * TL, tailZ = ( ROOT_S - 1.0 ) * TL, notchZ = ( ROOT_S - 0.998 ) * TL, flukeRootZ = ( ROOT_S - 0.868 ) * TL, rootS = ROOT_S,
	snoutY = float( ( PROFILE[ 0, 1 ] + PROFILE[ 0, 2 ] ) / 2 * TL ),
	pectoral = { k: dict( origin = [ round( float( v ), 5 ) for v in pec[ i ][ 0 ] ], basis = [ [ round( float( v ), 5 ) for v in r ] for r in pec[ i ][ 1 ] ] ) for i, k in enumerate( [ 'left', 'right' ] ) },
	blowhole = [ 0.0, float( prof( np.array( [ S_BLOW ] ) )[ 0 ][ 0 ] * TL ), float( ( ROOT_S - S_BLOW ) * TL ) ],
	textures = dict( albedo = 'bottlenose_albedo.png', height = 'bottlenose_height.png', size = [ W, H ], heightRange = [ h0, h1 ] ) )
with open( os.path.join( OUT, 'bottlenose.json' ), 'w' ) as f: json.dump( manifest, f )

# sanity: closed body volume -> mass (sea water 1025 kg/m^3), girth, triangle counts
bP, bT = levels[ 0 ][ 'bodyP' ], levels[ 0 ][ 'bodyT' ]
vol = abs( np.sum( np.einsum( 'ij,ij->i', bP[ bT[ :, 0 ] ], np.cross( bP[ bT[ :, 1 ] ], bP[ bT[ :, 2 ] ] ) ) ) / 6 )
xs, ys, _ = section( np.full( 400, 0.36 ), np.linspace( 0, 2 * np.pi, 400 ) )
girth = np.sum( np.hypot( np.diff( xs ), np.diff( ys ) ) ) * TL
print( 'DOLPHIN tris', [ l[ 'indices' ] // 3 for l in lv_out ], 'verts', [ l[ 'vertices' ] for l in lv_out ], 'volume m3 %.3f mass kg %.0f girth m %.2f (%.2f TL) heightRange %.4f %.4f bin %d' % ( vol, vol * 1025, girth, girth / TL, h0, h1, len( blob ) ) )

# ---------------------------------------------------------------- review renders

def img_np( img ):
	w, h = img.size; a = np.empty( w * h * 4, np.float32 ); img.pixels.foreach_get( a )
	return a.reshape( h, w, 4 )[ ::-1 ]  # top row first

def cover( path, w, h ):
	img = bpy.data.images.load( path ); iw, ih = img.size
	k = max( w / iw, h / ih ); img.scale( max( w, int( iw * k + 0.5 ) ), max( h, int( ih * k + 0.5 ) ) )
	a = img_np( img ); y0 = ( a.shape[ 0 ] - h ) // 2; x0 = ( a.shape[ 1 ] - w ) // 2
	return a[ y0:y0 + h, x0:x0 + w, :3 ]

def save_sheet( path, rows ):
	a = np.concatenate( [ np.concatenate( r, 1 ) for r in rows ], 0 )
	write_png( path, np.round( np.concatenate( [ np.clip( a, 0, 1 ), np.ones( a.shape[ :2 ] + ( 1, ) ) ], -1 ) * 255 ).astype( np.uint8 ) )

if RENDER:
	from mathutils import Vector
	for o in list( bpy.data.objects ): bpy.data.objects.remove( o, do_unlink = True )
	sc = bpy.context.scene
	L0 = levels[ 0 ]
	perm = lambda v: v[ :, [ 2, 0, 1 ] ]  # game (x, y, z) -> blender (z, x, y): +X snout, +Z up
	me = bpy.data.meshes.new( 'dolphin' )
	me.from_pydata( perm( L0[ 'P' ] ).tolist(), [], L0[ 'T' ].tolist() )
	uvl = me.uv_layers.new( name = 'UVMap' )
	uv = L0[ 'UV' ].copy(); uv[ :, 1 ] = 1 - uv[ :, 1 ]
	loops = np.empty( len( me.loops ), np.int32 ); me.loops.foreach_get( 'vertex_index', loops )
	uvl.data.foreach_set( 'uv', uv[ loops ].astype( np.float32 ).ravel() )
	me.shade_smooth()
	try: me.normals_split_custom_set_from_vertices( perm( L0[ 'N' ] ).tolist() )
	except Exception as e: print( 'custom normals failed', e )
	ob = bpy.data.objects.new( 'Dolphin', me ); sc.collection.objects.link( ob )
	mat = bpy.data.materials.new( 'DolphinSkin' ); mat.use_nodes = True; nt = mat.node_tree
	bsdf = nt.nodes[ 'Principled BSDF' ]
	ta = nt.nodes.new( 'ShaderNodeTexImage' ); ta.image = bpy.data.images.load( os.path.join( OUT, 'bottlenose_albedo.png' ) ); ta.image.alpha_mode = 'CHANNEL_PACKED'
	th = nt.nodes.new( 'ShaderNodeTexImage' ); th.image = bpy.data.images.load( os.path.join( OUT, 'bottlenose_height.png' ) ); th.image.colorspace_settings.name = 'Non-Color'
	sep = nt.nodes.new( 'ShaderNodeSeparateColor' ); bump = nt.nodes.new( 'ShaderNodeBump' )
	nt.links.new( ta.outputs[ 'Color' ], bsdf.inputs[ 'Base Color' ] ); nt.links.new( ta.outputs[ 'Alpha' ], bsdf.inputs[ 'Roughness' ] )
	nt.links.new( th.outputs[ 'Color' ], sep.inputs[ 'Color' ] ); nt.links.new( sep.outputs[ 'Red' ], bump.inputs[ 'Height' ] )
	bump.inputs[ 'Distance' ].default_value = h1 - h0
	nt.links.new( bump.outputs[ 'Normal' ], bsdf.inputs[ 'Normal' ] )
	ob.data.materials.append( mat )
	bpy.ops.mesh.primitive_plane_add( size = 40, location = ( 0, 0, - 0.46 ) )
	pm = bpy.data.materials.new( 'Stage' ); pm.use_nodes = True; pm.node_tree.nodes[ 'Principled BSDF' ].inputs[ 'Base Color' ].default_value = ( 0.32, 0.32, 0.32, 1 )
	pm.node_tree.nodes[ 'Principled BSDF' ].inputs[ 'Roughness' ].default_value = 0.7
	bpy.context.object.data.materials.append( pm )
	sc.world = bpy.data.worlds.new( 'W' ); sc.world.use_nodes = True
	sc.world.node_tree.nodes[ 'Background' ].inputs[ 'Color' ].default_value = ( 0.62, 0.66, 0.70, 1 ); sc.world.node_tree.nodes[ 'Background' ].inputs[ 'Strength' ].default_value = 0.55
	for loc, pw, sz in ( ( ( 1.0, - 2.5, 4.5 ), 900, 4 ), ( ( - 2.5, 3.5, 2.0 ), 300, 5 ) ):
		ld = bpy.data.lights.new( 'A', 'AREA' ); ld.energy = pw; ld.size = sz
		lo = bpy.data.objects.new( 'A', ld ); lo.location = loc; sc.collection.objects.link( lo )
		lo.rotation_euler = ( Vector( ( - 0.3, 0, 0 ) ) - Vector( loc ) ).to_track_quat( '-Z', 'Y' ).to_euler()
	sc.render.engine = 'CYCLES'
	try:
		pr = bpy.context.preferences.addons[ 'cycles' ].preferences; pr.compute_device_type = 'METAL'; pr.get_devices()
		for d in pr.devices: d.use = True
		sc.cycles.device = 'GPU'
	except Exception as e: print( 'gpu', e )
	sc.cycles.samples = 96; sc.cycles.use_denoising = True
	sc.render.resolution_x, sc.render.resolution_y = 1280, 640
	cams = [ ( 'side', ( - 0.36, - 7.2, 0.05 ), ( - 0.36, 0, 0.0 ), 70 ), ( 'three_quarter', ( 3.2, - 3.1, 1.25 ), ( - 0.25, 0, - 0.05 ), 50 ), ( 'dorsal', ( 1.3, - 2.4, 3.6 ), ( - 0.3, 0, - 0.05 ), 40 ) ]
	shots = []
	for name, loc, tgt, lens in cams:
		cd = bpy.data.cameras.new( name ); cd.lens = lens
		co = bpy.data.objects.new( name, cd ); co.location = loc; sc.collection.objects.link( co )
		co.rotation_euler = ( Vector( tgt ) - Vector( loc ) ).to_track_quat( '-Z', 'Y' ).to_euler()
		sc.camera = co; sc.render.filepath = os.path.join( SCR, 'render_%s.png' % name )
		bpy.ops.render.render( write_still = True ); shots.append( sc.render.filepath )
	refs = sorted( f for f in os.listdir( SCR ) if f.startswith( 'ref' ) and f.endswith( '.jpg' ) )
	cells = [ cover( os.path.join( SCR, f ), 480, 320 ) for f in refs[ :16 ] ]
	while len( cells ) % 4: cells.append( np.zeros( ( 320, 480, 3 ) ) )
	save_sheet( os.path.join( SCR, 'refs_contact.png' ), [ cells[ i:i + 4 ] for i in range( 0, len( cells ), 4 ) ] )
	rows = [ [ cover( shots[ i ], 1280, 640 ), cover( os.path.join( SCR, 'ref%02d.jpg' % REFS[ i ] ), 1280, 640 ) ] for i in range( 3 ) ]
	save_sheet( os.path.join( SCR, 'side_by_side.png' ), rows )
	print( 'DOLPHIN renders', shots )
