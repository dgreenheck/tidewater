// The drivable cars: the one table the game reads for each car. The picker, the rev
// gauge, the engine sound, the walking proxy, the nameplate and the wheel placement all read it, so a
// car is added here once. The physics twin is rally-physics/src/vehicle.rs: `id` is its kind, and
// mass, radius, mount, width, idle and redline must equal that config (test/vehicle-parity.mjs holds
// them equal; a stale copy drew wheels off the ground the physics drives on, or a redline the engine
// never reaches).
//   name       the display name. The key and file identify the car in rooms and saves.
//   tag        the one-line kind shown under the picker
//   file       public/rally/<file>.glb
//   mass       kg; radius, mount, width m (tyre radius, suspension mount height, tyre width)
//   tread      m tread depth; pressure Pa (contact patch for tyre marks); sinkage m in sand
//   idle, redline   rpm, scale the rev gauge and the engine recording's pitch
//   sound      public/rally/audio recording played for the engine
//   hull       m [ width, length ] footprint the sea is sampled under (CarWater), = vehicle.rs body
//   proxy      m half extents [ x, y, z ] of the box the player walks against while the car stands
//   plate      m above the car's origin where a shared-driving nameplate floats
//   camera, cameraHeight   m chase boom length and height
export const VEHICLES = {
	aster: {
		id: 0, name: 'Aster RS', tag: 'RWD coupe', file: 'aster_rs',
		mass: 1250, radius: 0.34, mount: 0.68, width: 0.235, tread: 0.09, pressure: 210000, treadPattern: 'rib', sinkage: 0.022,
		idle: 850, redline: 7200, sound: 'aster-inline-six.wav',
		hull: [ 1.72, 4.10 ], proxy: [ 0.96, 0.8, 2.25 ], plate: 1.7, camera: 7.5, cameraHeight: 3.1,
	},
	jeep: {
		id: 1, name: 'Ridgeback 4x4', tag: 'Lifted 4x4', file: 'black_jeep',
		mass: 2100, radius: 0.47, mount: 0.99, width: 0.38, tread: 0.18, pressure: 150000, treadPattern: 'mud', sinkage: 0.034,
		idle: 650, redline: 5600, sound: 'jeep-hemi.wav',
		hull: [ 1.82, 4.16 ], proxy: [ 1.21, 1.15, 2.6 ], plate: 2.3, camera: 8.3, cameraHeight: 3.8,
	},
	// The GT3-style car: the CarConcept model (CC BY 4.0, CREDITS.md) on the 911 GT3's engine,
	// gearbox and mass (vehicle.rs gt()). No flat-six recording yet: it borrows the Aster's six.
	gt: {
		id: 4, name: 'Petrel GT', tag: 'Rear-drive GT', file: 'concept_gt',
		mass: 1450, radius: 0.384, mount: 0.612, width: 0.284, tread: 0.09, pressure: 220000, treadPattern: 'rib', sinkage: 0.02,
		idle: 900, redline: 9000, sound: 'aster-inline-six.wav',
		hull: [ 2.20, 4.30 ], proxy: [ 1.12, 0.62, 2.2 ], plate: 1.55, camera: 7.6, cameraHeight: 3.0,
	},
	// The approved COSIER studio model, with its own hard points and seven-speed RS gearing.
	gt3rs: {
		id: 6, name: 'COSIER GT3 RS', tag: 'Rear-engine flat-six', file: 'cosier_gt3rs',
		mass: 1450, radius: 0.359, mount: 0.584, width: 0.305, tread: 0.09, pressure: 220000, treadPattern: 'rib', sinkage: 0.02,
		idle: 900, redline: 9000, sound: 'aster-inline-six.wav',
		hull: [ 1.90, 4.55 ], proxy: [ 1.014, 0.661, 2.286 ], plate: 1.6, camera: 7.4, cameraHeight: 2.8,
	},
	// The Lamborghini-style wedge: built in Blender by tools/rally/build_fulmine_v10.py at the Huracan
	// EVO's proportions (4.50 x 1.93 x 1.165 m), on vehicle.rs supercar(). No V10 recording yet: it
	// borrows the Aster's six, like the Petrel GT.
	supercar: {
		id: 2, name: 'Fulmine V10', tag: 'Mid-engine supercar', file: 'fulmine_v10',
		mass: 1550, radius: 0.336, mount: 0.56, width: 0.275, tread: 0.09, pressure: 230000, treadPattern: 'rib', sinkage: 0.02,
		idle: 1000, redline: 8500, sound: 'aster-inline-six.wav',
		hull: [ 1.90, 4.45 ], proxy: [ 0.97, 0.58, 2.25 ], plate: 1.5, camera: 7.6, cameraHeight: 2.9,
	},
	// The horseshoe-grille hypercar: built in Blender by tools/rally/build_corsaire_w16.py at the
	// Chiron's proportions (4.54 x 2.04 x 1.21 m), on vehicle.rs hypercar(). No W16 recording yet: it
	// borrows the Aster's six.
	hypercar: {
		id: 3, name: 'Corsaire W16', tag: 'Mid-engine hypercar', file: 'corsaire_w16',
		mass: 1995, radius: 0.348, mount: 0.58, width: 0.32, tread: 0.09, pressure: 240000, treadPattern: 'rib', sinkage: 0.02,
		idle: 900, redline: 6800, sound: 'aster-inline-six.wav',
		hull: [ 2.00, 4.48 ], proxy: [ 1.02, 0.61, 2.27 ], plate: 1.55, camera: 7.8, cameraHeight: 3.0,
	},
	// The open-tub beach buggy: built in Blender by tools/rally/build_sandpiper.py at a Meyers Manx's
	// proportions (2.03 m wheelbase, about 3.3 x 1.6 m), on vehicle.rs buggy(). Knobbly 'mud' prints for
	// the sand it is built for. No flat-four recording yet: it borrows the Aster's six.
	buggy: {
		id: 5, name: 'Sandpiper 1600', tag: 'Open-tub beach buggy', file: 'sandpiper',
		mass: 620, radius: 0.345, mount: 0.70, width: 0.2, tread: 0.12, pressure: 140000, treadPattern: 'mud', sinkage: 0.03,
		idle: 900, redline: 5600, sound: 'aster-inline-six.wav',
		hull: [ 1.50, 3.30 ], proxy: [ 0.82, 0.66, 1.72 ], plate: 1.7, camera: 6.6, cameraHeight: 2.8,
	},
};
