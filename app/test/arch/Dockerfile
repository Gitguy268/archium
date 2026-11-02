# Arch Linux with what Hillium needs at run time, plus Xvfb and Node for the e2e suite.
FROM archlinux:base-devel
# pacman's download sandbox needs seccomp, which amd64 emulation on Apple silicon lacks.
RUN sed -i 's/^\[options\]/[options]\nDisableSandbox/' /etc/pacman.conf \
 && pacman -Syu --noconfirm --needed nodejs gtk3 nss alsa-lib libxss libxtst libxrandr libxkbcommon mesa libsecret \
      xdg-utils hicolor-icon-theme xorg-server-xvfb xorg-xauth ttf-dejavu noto-fonts-emoji dbus \
 && pacman -Scc --noconfirm \
 && useradd -m builder \
 && echo "builder ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/builder
