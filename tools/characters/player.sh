#!/bin/zsh
# Rebuild the player character (public/models/characters/player.glb) from Microsoft Rocketbox (MIT).
# Needs: Blender 5.x, Python 3 + Pillow (print tile), curl. No ImageMagick.
#   tools/characters/player.sh [workdir]
set -e
HERE=${0:A:h}; ROOT=${HERE:h:h}; WORK=${1:-${TMPDIR:-$(node -p "require('node:os').tmpdir()")}/rocketbox-player}
BLENDER=${BLENDER:-blender}
mkdir -p $WORK && cd $WORK
A=Assets/Avatars/Adults/Male_Adult_01
: > files
echo $A/Export/Male_Adult_01.fbx >> files
for k in body_color body_normal body_specular head_color head_normal head_specular opacity_color; do echo $A/Textures/m002_$k.tga >> files; done
for c in walk_neutral_01 walk_neutral_02 walk_neutral run_slow_01 run_neutral_01 run_neutral run_fast_01 run_fast_02; do
	echo Assets/Animations/all_animations_max_motextr_xy/m_$c.max.fbx >> files; done
echo Assets/Animations/all_animations_max_motextr_static/m_idle_neutral_01.max.fbx >> files
tr '\n' '\0' < files | xargs -0 -P 16 -n 1 $HERE/fetch.sh
python3 $HERE/player_print.py $WORK/print.png 1024
$BLENDER -b --python $HERE/player.py -- $WORK $ROOT/public/models/characters/player.glb $WORK/print.png
