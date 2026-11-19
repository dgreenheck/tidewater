#!/bin/zsh
# Rebuild the ferry crowd (foot passengers and drivers, src/ferry/Crowd.js) from Microsoft Rocketbox
# (MIT, https://github.com/microsoft/Microsoft-Rocketbox), reusing fetch.sh, textures.sh and convert.py unchanged.
# Needs: Blender 4.2+ (tested 5.0), ImageMagick (else crowd_textures.py does the maps in Blender), curl, gh (GitHub CLI) for listing texture files.
#   tools/characters/build_crowd.sh [workdir]
# Output: public/models/characters/crowd/<name>.glb, 512² maps (SIZE=1024 for sharper ones).
# The walk comes from the motextr_xy set (the static set has no walks), so it still carries its root motion:
# Crowd.js measures the pelvis travel per cycle, strips it and plays the walk at the rate that matches the pace.
set -e
HERE=${0:A:h}; ROOT=${HERE:h:h}; WORK=${1:-${TMPDIR:-$(node -p "require('node:os').tmpdir()")}/rocketbox-crowd}
BLENDER=${BLENDER:-blender}
SIZE=${SIZE:-512}; JOBS=${JOBS:-4}
OUT=${OUT:-$ROOT/public/models/characters/crowd}   # OUT=<dir> builds elsewhere (check, then crowd_keys.mjs, then copy)
mkdir -p $WORK/log $OUT && cd $WORK
# avatar : clip set (m / f) : output name
AVATARS=( Adults/Female_Adult_01:f:f01 Adults/Female_Adult_03:f:f03 Adults/Female_Adult_06:f:f06
	Adults/Female_Adult_09:f:f09 Adults/Male_Adult_01:m:m01 Adults/Male_Adult_04:m:m04
	Adults/Male_Adult_07:m:m07 Adults/Male_Adult_10:m:m10 )
S=Assets/Animations/all_animations_max_motextr_static; X=Assets/Animations/all_animations_max_motextr_xy
STATIC=( idle_neutral_01 idle_look_around_01 sit_chair_idle_neutral_01 gestic_talk_neutral_01
	wave_01 gestic_presentation_right_01 gestic_listen_accept_01 cell_phone_talk_01
	gestic_shrug_01 gestic_laugh_low sit_chair_idle_look_around sit_chair_idle_relaxed_01
	sit_chair_gestic_thoughtful sit_chair_idle_yawn   # the townsfolk (src/people): shrug, laugh, seated variety
	idle_angry_01 crouch_idle )                        # bumps (src/people/Contact.js): the glare, crouched to pick something up
MOVING=( walk_neutral_01 crouch_in crouch_out )      # down into the crouch and back up (a get-up, a pick-up)
: > files
for a in $AVATARS; do
	d=${a%%:*}; n=$(basename $d)
	echo "Assets/Avatars/$d/Export/$n.fbx" >> files
	gh api "repos/microsoft/Microsoft-Rocketbox/contents/Assets/Avatars/$d/Textures" --jq '.[].name' | sed "s#^#Assets/Avatars/$d/Textures/#" >> files
done
for c in $STATIC; do for g in m f; do echo "$S/${g}_$c.max.fbx"; done; done >> files
for c in $MOVING; do for g in m f; do echo "$X/${g}_$c.max.fbx"; done; done >> files
echo LICENSE.md >> files
# a clip missing from one set (m_ or f_: the phone call is men only) just fails to fetch; each avatar gets what arrived
while read f; do [ -s "$f" ] || print -r -- "$f"; done < files | tr '\n' '\0' | xargs -0 -P 16 -n 1 $HERE/fetch.sh || true
find Assets -type f -size 0 -delete
cp LICENSE.md $ROOT/public/models/characters/LICENSE-Rocketbox.md
i=0
for a in $AVATARS; do
	d=${a%%:*}; r=${a#*:}; g=${r%%:*}; out=${r#*:}; n=$(basename $d)
	p=$(basename $(ls Assets/Avatars/$d/Textures/*_body_color.tga | head -n 1) _body_color.tga)
	# ImageMagick's textures.sh where it is installed, the same maps from Blender where it is not
	if (( $+commands[magick] )); then $HERE/textures.sh Assets/Avatars/$d/Textures tex/$p $p $SIZE > log/$out.tex.log
	else $BLENDER -b --python $HERE/crowd_textures.py -- Assets/Avatars/$d/Textures tex/$p $p $SIZE > log/$out.tex.log 2>&1; fi
	CL=(); for c in $STATIC; do [ -s $S/${g}_$c.max.fbx ] && CL+=( $S/${g}_$c.max.fbx ); done
	for c in $MOVING; do [ -s $X/${g}_$c.max.fbx ] && CL+=( $X/${g}_$c.max.fbx ); done
	$BLENDER -b --python $HERE/convert.py -- Assets/Avatars/$d/Export/$n.fbx tex/$p $p $OUT/$out.glb $CL > log/$out.log 2>&1 &
	i=$((i + 1)); (( i % JOBS == 0 )) && wait
done
wait
ls -l $OUT
