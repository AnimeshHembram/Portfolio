// Register the GSAP Flip plugin so it can be used
gsap.registerPlugin(Flip);

// Preloads images (and background images if used)
const preloadImages = (selector = 'img') => {
  return new Promise((resolve) => {
    imagesLoaded(
      document.querySelectorAll(selector),
      { background: true },
      resolve
    );
  });
};

// Wait until the DOM is fully loaded before running the script
document.addEventListener('DOMContentLoaded', async function () {
  // Get the grid gallery container element
  const gridGallery = document.getElementById('grid-gallery');
  // Stop execution if gridGallery does not exist
  if (!gridGallery) return;

  // Keep the loading state until images are ready
  await preloadImages('.image');

  // Remove the "loading" class from the body (usually used for preload states)
  document.body.classList.remove('loading');

  // Select all grid size configuration buttons
  const triggerButtons = document.querySelectorAll(
    '.configuration_grid_size button'
  );

  // Select all grid gallery items
  const allGridItem = document.querySelectorAll('.grid_gallery_item');

  // Flag to prevent multiple animations at the same time
  // currentGridSize stores the active grid size
  let animated = false,
    currentGridSize = gridGallery.dataset.sizeGrid || '75%';

  // Loop through each configuration button
  triggerButtons.forEach((btn) => {
    // Add click event listener to each button
    btn.addEventListener('click', () => {
      // Prevent interaction if an animation is already running
      if (animated) return;

      // Get the target grid size from data-size attribute
      const targetSize = btn.dataset.size;

      // If the clicked size is already active, do nothing
      if (targetSize === currentGridSize) return;

      // Lock animation state
      animated = true;

      // Capture the current position and size of all grid items
      const state = Flip.getState(allGridItem);

      // Update grid size using data attribute (used by CSS)
      gridGallery.dataset.sizeGrid = targetSize;

      // Update current grid size state
      currentGridSize = targetSize;

      // Remove "active" class from all buttons
      triggerButtons.forEach((btn) => {
        btn.classList.remove('active');
      });

      // Add "active" class to the clicked button
      btn.classList.add('active');

      const flipDuration = 1;
      const staggerAmount = 0.3;
      const totalFlipDuration = flipDuration + staggerAmount;

      // Animate elements from the previous state to the new layout
      Flip.from(state, {
        absolute: true,
        duration: flipDuration, // Animation duration in seconds
        ease: 'expo.inOut', // Smooth easing for natural motion
        onComplete: () => {
          // Unlock animation after completion
          animated = false;
        },
        stagger: {
          amount: staggerAmount,
          from: 'random',
        },
      }).fromTo(
        gridGallery,
        {
          filter: 'blur(0px) brightness(100%)',
          willChange: 'filter',
        },
        {
          duration: totalFlipDuration,
          keyframes: [
            {
              filter: 'blur(10px) brightness(200%)',
              duration: totalFlipDuration * 0.5,
              ease: 'power2.in',
            },
            {
              filter: 'blur(0px) brightness(100%)',
              duration: totalFlipDuration * 0.5,
              ease: 'power2',
              delay: 0.5,
            },
          ],
        },
        0
      );
    });
  });
});
