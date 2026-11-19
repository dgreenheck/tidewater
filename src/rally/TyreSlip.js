// Tyre squeal and smoke follow sliding speed at a loaded, dry contact. The
// wheel-speed channel is signed; ground speed is a magnitude. Slip ratio from
// the solver preserves the contact direction even in reverse or on a ferry.
export function hardTyreSlip( state, wheel ) {
	const i = 29 + wheel * 10, surface = state[ 89 + wheel ];
	if ( ! state[ 16 + wheel * 4 ] || state[ i + 6 ] < 120 || state[ i + 7 ] <= 0.2 || ( surface !== 2 && surface !== 3 && surface !== 5 ) ) return 0;
	if ( state[ 93 ] > -999 && state[ i + 1 ] <= state[ 93 ] ) return 0;
	const speed = state[ i + 8 ], lateral = state[ i + 9 ];
	const longitudinal = Math.sqrt( Math.max( 0, speed * speed - lateral * lateral ) );
	const slip = Math.hypot( state[ 81 + wheel ] * Math.max( 3, longitudinal ), lateral ); // m/s, solver's 3 m/s slip floor
	return Math.min( 1, slip / 9 ) * Math.max( 0, ( state[ i + 7 ] - 0.2 ) / 0.8 ) * Math.min( 1, state[ i + 6 ] / 1800 );
}
