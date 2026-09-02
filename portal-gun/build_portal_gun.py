#!/usr/bin/env python3
"""
Aperture Science Handheld Portal Device (ASHPD) - printable replica generator.

Builds the portal gun from Portal / Portal 2 as a set of watertight, print-ready
STL parts plus a combined model, a colored GLB and a self-contained HTML viewer.

    python3 build_portal_gun.py            # full scale (~530 mm long)
    python3 build_portal_gun.py --scale 0.5

Axes: +X points forward out of the muzzle, +Z is up, Y is sideways.
All dimensions are millimetres at scale 1.0.

Requires: trimesh, manifold3d, numpy, shapely   (pip install trimesh manifold3d shapely)
"""
import argparse, base64, json, os, struct
import numpy as np
import trimesh
from shapely.geometry import Point

OUT = os.path.dirname(os.path.abspath(__file__))
ENGINE = "manifold"

# ---------------------------------------------------------------- colours
WHITE = [242, 242, 238, 255]
BLACK = [28, 28, 30, 255]
DARK = [45, 45, 48, 255]
BLUE = [70, 200, 255, 255]
STEEL = [120, 122, 128, 255]

X, Y, Z = np.eye(3)

# ---------------------------------------------------------------- helpers
def union(meshes):
    meshes = [m for m in meshes if m is not None and len(m.faces)]
    if len(meshes) == 1:
        return meshes[0]
    return trimesh.boolean.union(meshes, engine=ENGINE)

def difference(a, b):
    return trimesh.boolean.difference([a, b], engine=ENGINE)

def intersection(a, b):
    return trimesh.boolean.intersection([a, b], engine=ENGINE)

def rot(axis, deg, point=None):
    return trimesh.transformations.rotation_matrix(np.radians(deg), axis, point)

def trans(v):
    return trimesh.transformations.translation_matrix(v)

def revolve_x(profile, sections=96):
    """Revolve an (x, r) closed profile about the X axis."""
    prof = np.array([[r, x] for x, r in profile], float)  # (radius, height-along-Z)
    m = trimesh.creation.revolve(prof, sections=sections)
    m.apply_transform(rot(Y, 90))          # Z -> X
    return m

def cyl_x(r, x0, x1, sections=64):
    m = trimesh.creation.cylinder(radius=r, height=x1 - x0, sections=sections)
    m.apply_transform(rot(Y, 90))
    m.apply_translation([(x0 + x1) / 2, 0, 0])
    return m

def cyl_between(p0, p1, r, sections=32):
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0
    m = trimesh.creation.cylinder(radius=r, height=np.linalg.norm(d), sections=sections)
    m.apply_transform(trimesh.geometry.align_vectors(Z, d / np.linalg.norm(d)))
    m.apply_translation((p0 + p1) / 2)
    return m

def sphere(r, c, subdiv=3):
    m = trimesh.creation.icosphere(subdivisions=subdiv, radius=r)
    m.apply_translation(c)
    return m

def box(size, center=(0, 0, 0), transform=None):
    m = trimesh.creation.box(extents=size)
    if transform is not None:
        m.apply_transform(transform)
    m.apply_translation(center)
    return m

def hull(points):
    return trimesh.Trimesh(np.asarray(points, float)).convex_hull

def tapered_bar(p0, p1, w0, t0, w1, t1, up):
    """Convex hull of a rectangle (w0 x t0) at p0 and (w1 x t1) at p1.
    'up' is the direction of the thickness axis (t), width is perpendicular."""
    p0, p1, up = map(lambda v: np.asarray(v, float), (p0, p1, up))
    d = p1 - p0; d /= np.linalg.norm(d)
    up = up - d * np.dot(up, d); up /= np.linalg.norm(up)
    side = np.cross(d, up)
    pts = []
    for p, w, t in ((p0, w0, t0), (p1, w1, t1)):
        for sw in (-1, 1):
            for st in (-1, 1):
                pts.append(p + side * sw * w / 2 + up * st * t / 2)
    return hull(pts)

def catmull_rom(pts, per_seg=12):
    pts = np.asarray(pts, float)
    p = np.vstack([pts[0], pts, pts[-1]])
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for t in np.linspace(0, 1, per_seg, endpoint=False):
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(p[-2])
    return np.array(out)

def tube(path, r, sections=20):
    return trimesh.creation.sweep_polygon(Point(0, 0).buffer(r, sections // 4), np.asarray(path, float), cap=True)

def halfspace_box(normal, point, size=2000):
    """A huge box occupying the side of the plane the normal points to."""
    n = np.asarray(normal, float); n /= np.linalg.norm(n)
    m = trimesh.creation.box(extents=[size, size, size])
    m.apply_translation([0, 0, size / 2])
    m.apply_transform(trimesh.geometry.align_vectors(Z, n))
    m.apply_translation(point)
    return m

# ---------------------------------------------------------------- SHELL
def egg_radius(x, a_rear=160.0, a_front=225.0, R=102.0):
    a = a_rear if x < 0 else a_front
    v = 1 - (x / a) ** 2
    return R * np.sqrt(max(v, 0.0))

def build_shell():
    """White egg shaped rear shell, hollow, cut open at the front at an angle."""
    wall = 6.0
    xs = np.linspace(-159.5, 150, 96)
    outer = [(x, egg_radius(x)) for x in xs]
    inner = [(x, max(egg_radius(x) - wall, 0.0)) for x in xs[::-1] if egg_radius(x) - wall > 0]
    # close the profile: rear tip on the axis, front is open (gets cut by the plane below)
    profile = [(-160.0, 0.0)] + outer + [(151, egg_radius(150)), (151, 0.0)]
    solid = revolve_x(profile, sections=128)
    inner_profile = [(-160.0 + wall, 0.0)] + [(x, egg_radius(x) - wall) for x in xs if egg_radius(x) - wall > 0] \
                    + [(155, egg_radius(150) - wall), (155, 0.0)]
    cavity = revolve_x(inner_profile, sections=128)
    shell = difference(solid, cavity)
    # Angled front cut: the top lip reaches further forward than the bottom lip.
    cut_normal = np.array([1.0, 0.0, -0.5]); cut_normal /= np.linalg.norm(cut_normal)
    shell = difference(shell, halfspace_box(cut_normal, [92, 0, 0]))
    # Seam groove around the shell (the panel line of the real prop).
    groove = difference(cyl_x(140, -32, -29.5), cyl_x(egg_radius(-31) - 1.6, -33, -29))
    shell = difference(shell, groove)
    # Recessed cable port block area on top rear + cutouts for the cable port.
    shell = difference(shell, box([44, 40, 30], [-88, 0, egg_radius(-88) + 6]))
    return shell

def add_pin_holes(shell, wall=6.0):
    # Alignment pin holes across the print split plane (y = 0): 2.1 mm radius,
    # sitting in the middle of the wall; use 4 mm filament or dowel as the pin.
    for c in ([-160 + wall / 2 + 1, 0, 0], [-30, 0, egg_radius(-30) - wall / 2],
              [-30, 0, -(egg_radius(-30) - wall / 2)], [40, 0, egg_radius(40) - wall / 2]):
        pin = trimesh.creation.cylinder(radius=2.1, height=18, sections=24)
        pin.apply_transform(rot(X, 90)); pin.apply_translation(c)
        shell = difference(shell, pin)
    return shell

# ---------------------------------------------------------------- CHASSIS (black inner body)
def build_chassis():
    body = revolve_x([(-70, 0), (-70, 80), (-50, 86), (40, 86), (48, 72), (62, 72), (94, 56), (102, 56),
                      (102, 30), (106, 30), (106, 0)], sections=96)
    ribs = []
    for k in range(3):
        r = box([50, 8, 14], [-35, 0, 88])
        r.apply_transform(rot(X, 30 + k * 120))
        ribs.append(r)
    # cable port block on top rear of the shell
    port = box([40, 36, 26], [-88, 0, egg_radius(-88) + 4])
    return union([body, port] + ribs)

# ---------------------------------------------------------------- CORE (glowing blue tube)
def build_core():
    core = cyl_x(24, 40, 175, sections=80)
    # inner emitter that shows through the muzzle
    tip = cyl_x(15, 278, 292, sections=48)
    ring = revolve_x([(266, 0), (266, 29), (282, 29), (282, 0)], sections=64)
    return union([core, tip, ring])

# ---------------------------------------------------------------- BARREL (black front cannon)
def build_barrel():
    prof = [(150, 0), (150, 40), (158, 40), (160, 46)]
    x = 160
    # grooves along the body
    for gx in (186, 214):
        prof += [(gx, 46), (gx + 1.5, 42.5), (gx + 5.5, 42.5), (gx + 7, 46)]
    prof += [(244, 46), (246, 41), (254, 41), (256, 51), (270, 51), (272, 46), (282, 46),
             (285, 53), (300, 53), (304, 49), (304, 33), (296, 33), (296, 20), (268, 20), (268, 0)]
    barrel = revolve_x(prof, sections=112)
    # three struts that bridge from the chassis to the barrel around the blue core
    struts = []
    for k in range(3):
        s = box([70, 7, 7], [130, 0, 36])
        s.apply_transform(rot(X, 60 + k * 120))
        struts.append(s)
    # muzzle vents
    barrel = union([barrel] + struts)
    for k in range(8):
        v = box([14, 4, 12], [292, 0, 50])
        v.apply_transform(rot(X, k * 45 + 22.5))
        barrel = difference(barrel, v)
    return barrel

# ---------------------------------------------------------------- CLAWS
def build_claw(phi_deg):
    """One articulated claw. phi is the angle around the X axis (90 = top)."""
    phi = np.radians(phi_deg)
    u = np.array([0, np.cos(phi), np.sin(phi)])       # radial (outward)
    t = np.array([0, -np.sin(phi), np.cos(phi)])      # tangential
    P = lambda x, r: np.array([x, 0, 0]) + u * r
    p_mount = P(60, 78)
    p0 = P(80, 100)           # base hinge
    p1 = P(190, 128)          # elbow
    p2 = P(270, 112)          # wrist
    p3 = P(345, 68)           # tip
    parts = [
        # mount bracket into the shell rim
        tapered_bar(p_mount, p0, 20, 14, 22, 18, u),
        cyl_between(p0 - t * 13, p0 + t * 13, 10),
        sphere(10.5, p0 - t * 13, 2), sphere(10.5, p0 + t * 13, 2),
        # upper arm
        tapered_bar(p0, p1, 17, 12, 15, 11, u),
        cyl_between(p1 - t * 11, p1 + t * 11, 8.5),
        # fore arm
        tapered_bar(p1, p2, 14, 10, 11, 9, u),
        cyl_between(p2 - t * 8, p2 + t * 8, 6.5),
        # finger, tapering to a point
        tapered_bar(p2, p3, 10, 8, 2.5, 2.5, u),
        sphere(1.8, p3, 1),
        # pistons / actuator rod along the upper arm
        cyl_between(p0 + u * 5 + (p1 - p0) * 0.15, p1 - u * 3 + (p0 - p1) * 0.1, 3.5, 16),
    ]
    return union(parts)

# ---------------------------------------------------------------- CABLES
def build_cables():
    """Three cables from the rear port, over the top of the shell, down to the barrel."""
    parts = []
    def surface_path(y, r, x_end=196, z_end=42):
        pts = []
        for x in np.linspace(-98, 84, 14):
            R = egg_radius(x)
            z = np.sqrt(max(R * R - y * y, 1.0)) + r + 1.2
            pts.append([x, y, z])
        pts += [[120, y * 0.85, 78], [160, y * 0.7, 56], [x_end, y * 0.6, z_end]]
        return catmull_rom(pts, 8)
    for y, r in ((0, 6.5), (-15, 4.5), (15, 4.5)):
        parts.append(tube(surface_path(y, r), r))
    # clamps that hold the cables to the shell
    for cx in (-40, 20, 70):
        R = egg_radius(cx)
        parts.append(box([9, 44, 12], [cx, 0, R + 2]))
    return union(parts)

# ---------------------------------------------------------------- HANDLE
def build_handle():
    # main grip, angled back
    g0 = np.array([-8, 0, -92]); g1 = np.array([-52, 0, -205])
    grip = tapered_bar(g0, g1, 30, 24, 28, 22, X)
    # finger grooves
    for i in range(4):
        f = cyl_between([-14 - i * 8.6, -30, -112 - i * 24], [-14 - i * 8.6, 30, -112 - i * 24], 4.5, 20)
        grip = difference(grip, f)
    # base cap and butt
    butt = box([40, 30, 10], [-56, 0, -210])
    # trigger guard loop: down from the shell in front of the grip, then back to the grip base
    guard = union([
        tapered_bar([52, 0, -90], [40, 0, -180], 12, 18, 12, 16, X),
        tapered_bar([40, 0, -180], [-40, 0, -206], 12, 16, 12, 16, Z),
    ])
    trigger = tapered_bar([22, 0, -98], [8, 0, -150], 12, 10, 8, 8, X)
    top = box([100, 34, 16], [12, 0, -94])
    return union([grip, butt, guard, trigger, top])

# ---------------------------------------------------------------- assembly / export
def write_viewer(parts, scale, path):
    """Self-contained WebGL viewer with the mesh embedded (int16 quantised)."""
    blobs = []
    allv = np.vstack([m.vertices for m, _, _ in parts])
    lo, hi = allv.min(0), allv.max(0)
    span = float((hi - lo).max())
    for m, name, color in parts:
        v = ((m.vertices - lo) / span * 2 - 1) * 32000
        v = np.round(v).astype(np.int16)
        f = m.faces.astype(np.uint32)
        blobs.append({"name": name, "color": [c / 255 for c in color[:3]], "size": m.extents.tolist(),
                      "nv": len(v), "nf": len(f),
                      "v": base64.b64encode(v.tobytes()).decode(),
                      "f": base64.b64encode(f.tobytes()).decode()})
    meta = {"scale": scale, "span": span, "lo": lo.tolist(), "extents": (hi - lo).tolist(), "parts": blobs}
    with open(os.path.join(OUT, "viewer_template.html")) as fh:
        html = fh.read()
    html = html.replace("/*__MODEL__*/null", json.dumps(meta))
    with open(path, "w") as fh:
        fh.write(html)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=float, default=1.0, help="uniform scale for the exported STLs")
    ap.add_argument("--out", default=os.path.join(OUT, "stl"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    print("building shell..."); shell = build_shell()
    print("building chassis..."); chassis = build_chassis()
    print("building core..."); core = build_core()
    print("building barrel..."); barrel = build_barrel()
    print("building claws...")
    claws = [build_claw(a) for a in (90, 210, 330)]
    print("building cables..."); cables = build_cables()
    print("building handle..."); handle = build_handle()

    # trim the cable ends that poke inside the shell / barrel so the STL is clean
    cables = difference(cables, cyl_x(46, 140, 260))

    parts = [
        (shell, "shell", WHITE),
        (chassis, "chassis", BLACK),
        (core, "core", BLUE),
        (barrel, "barrel", BLACK),
        (claws[0], "claw_top", DARK),
        (claws[1], "claw_left", DARK),
        (claws[2], "claw_right", DARK),
        (cables, "cables", BLACK),
        (handle, "handle", BLACK),
    ]

    # print-friendly split of the shell into two mirror halves
    pinned = add_pin_holes(shell)
    left = intersection(pinned, halfspace_box([0, -1, 0], [0, 0, 0]))
    right = intersection(pinned, halfspace_box([0, 1, 0], [0, 0, 0]))
    split_parts = [(left, "shell_left", WHITE), (right, "shell_right", WHITE)]

    S = np.diag([args.scale] * 3 + [1])
    for m, name, color in parts + split_parts:
        m2 = m.copy(); m2.apply_transform(S)
        assert m2.is_watertight, name
        m2.export(os.path.join(args.out, f"{name}.stl"))
        ext = m2.extents
        print(f"  {name:12s} {len(m2.faces):7d} tris  {ext[0]:6.1f} x {ext[1]:6.1f} x {ext[2]:6.1f} mm  watertight={m2.is_watertight}")

    full = union([m for m, _, _ in parts]); full.apply_transform(S)
    full.export(os.path.join(args.out, "portal_gun_full.stl"))
    print(f"  full model   {len(full.faces)} tris  {full.extents.round(1)} mm watertight={full.is_watertight} bodies={len(full.split(only_watertight=False))}")

    scene = trimesh.Scene()
    for m, name, color in parts:
        m2 = m.copy(); m2.apply_transform(S)
        m2.visual = trimesh.visual.ColorVisuals(m2, face_colors=color)
        scene.add_geometry(m2, node_name=name, geom_name=name)
    scene.export(os.path.join(OUT, "portal_gun.glb"))
    write_viewer(parts, args.scale, os.path.join(OUT, "viewer.html"))
    print("done")

if __name__ == "__main__":
    main()
