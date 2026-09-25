// Keyboard / mouse input with pointer lock support.
export class Input {

	constructor( dom ) {

		this.dom = dom;
		this.keys = new Set();
		this.pressed = new Set();
		this.look = { x: 0, y: 0 };
		this.wheel = 0;
		this.mouseDown = false;
		this.rightDown = false;
		this.gamepadKeys = new Set();
		this.gamepadMouseDown = false;
		this.gamepadRightDown = false;
		this.gamepadConnected = false;
		this.locked = false;
		this.enabled = true;

		window.addEventListener( 'keydown', ( e ) => {

			if ( e.target && ( e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' ) ) return;
			if ( ! this.keys.has( e.code ) ) this.pressed.add( e.code );
			this.keys.add( e.code );
			if ( [ 'Space', 'ArrowUp', 'ArrowDown', 'Tab' ].includes( e.code ) ) e.preventDefault();

		} );
		window.addEventListener( 'keyup', ( e ) => this.keys.delete( e.code ) );
		window.addEventListener( 'blur', () => this.keys.clear() );

		dom.addEventListener( 'mousedown', ( e ) => {

			if ( e.button === 0 ) this.mouseDown = true;
			if ( e.button === 2 ) this.rightDown = true;

		} );
		window.addEventListener( 'mouseup', ( e ) => {

			if ( e.button === 0 ) this.mouseDown = false;
			if ( e.button === 2 ) this.rightDown = false;

		} );
		dom.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );
		window.addEventListener( 'mousemove', ( e ) => {

			if ( this.locked || this.mouseDown || this.rightDown ) {

				this.look.x += e.movementX;
				this.look.y += e.movementY;

			}

		} );
		dom.addEventListener( 'wheel', ( e ) => {

			this.wheel += Math.sign( e.deltaY );
			e.preventDefault();

		}, { passive: false } );

		document.addEventListener( 'pointerlockchange', () => {

			this.locked = document.pointerLockElement === dom;

		} );

	}

	requestLock() {

		if ( ! this.locked ) this.dom.requestPointerLock?.()?.catch?.( () => {} );

	}

	// Standard-mapped controllers (including Xbox pads) mirror the keyboard / mouse actions
	// used by the game. Keeping the mapping here means gameplay systems stay device agnostic.
	updateGamepad( dt ) {

		const pads = globalThis.navigator?.getGamepads?.() || [];
		const pad = Array.from( pads ).find( ( p ) => p && p.connected );
		this.gamepadConnected = Boolean( pad );
		const next = new Set();
		const deadzone = 0.22;
		const axis = ( index ) => Math.abs( pad?.axes[ index ] || 0 ) > deadzone ? pad.axes[ index ] : 0;
		const button = ( index ) => {

			const b = pad?.buttons[ index ];
			return Boolean( b && ( b.pressed || b.value > 0.5 ) );

		};
		const add = ( code, active ) => {

			if ( active ) next.add( code );

		};

		if ( pad ) {

			const moveX = axis( 0 ), moveY = axis( 1 );
			add( 'KeyA', moveX < - deadzone );
			add( 'KeyD', moveX > deadzone );
			add( 'KeyW', moveY < - deadzone );
			add( 'KeyS', moveY > deadzone );

			// Right stick is a continuous first-person / chase-camera look control.
			this.look.x += axis( 2 ) * 720 * dt;
			this.look.y += axis( 3 ) * 720 * dt;

			// A / B / X / Y, bumpers, triggers, and system buttons on the Xbox layout.
			add( 'Space', button( 0 ) ); // A: jump, swim up, climb
			add( 'KeyC', button( 1 ) ); // B: dive / descend
			add( 'KeyE', button( 2 ) ); // X: interact / confirm
			add( 'KeyR', button( 3 ) ); // Y: equip fishing rod
			add( 'ShiftLeft', button( 4 ) ); // LB: sprint / boat boost
			add( 'KeyV', button( 5 ) ); // RB: boat camera
			add( 'KeyM', button( 8 ) ); // View: mute
			add( 'KeyH', button( 9 ) ); // Menu: settings
			add( 'KeyF', button( 10 ) ); // left stick press: free camera
			add( 'KeyL', button( 11 ) ); // right stick press: flashlight
			add( 'ArrowUp', button( 12 ) ); // d-pad up
			add( 'ArrowDown', button( 13 ) ); // d-pad down
			add( 'ArrowLeft', button( 14 ) ); // d-pad left
			add( 'ArrowRight', button( 15 ) ); // d-pad right

		}

		for ( const code of next ) if ( ! this.gamepadKeys.has( code ) ) this.pressed.add( code );
		this.gamepadKeys = next;
		this.gamepadMouseDown = button( 7 ); // RT: cast / strike / reel
		this.gamepadRightDown = button( 6 ); // LT: reel empty line

	}

	down( code ) {

		return this.enabled && ( this.keys.has( code ) || this.gamepadKeys.has( code ) );

	}

	// true once per physical key press
	hit( code ) {

		return this.enabled && this.pressed.has( code );

	}

	consumeLook() {

		const l = { x: this.look.x, y: this.look.y };
		this.look.x = 0;
		this.look.y = 0;
		return l;

	}

	consumeWheel() {

		const w = this.wheel;
		this.wheel = 0;
		return w;

	}

	primaryDown() {

		return this.enabled && ( this.mouseDown || this.gamepadMouseDown );

	}

	secondaryDown() {

		return this.enabled && ( this.rightDown || this.gamepadRightDown );

	}

	endFrame() {

		this.pressed.clear();

	}

}
