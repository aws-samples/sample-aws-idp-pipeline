import io
from typing import Callable

from PIL import Image
from strands import tool


def create_image_rotator_tool(
    image_data_getter: Callable[[], bytes],
    image_data_setter: Callable[[bytes], None],
    analysis_steps: list
):
    """Create an image rotator tool with context.

    Args:
        image_data_getter: Function to get current image data
        image_data_setter: Function to set new image data
        analysis_steps: List to append analysis steps
    """

    @tool
    def rotate_image(degrees: int) -> str:
        """Rotate the current document image by specified degrees.

        Use this tool when text appears upside down, sideways, or at an angle.
        Common rotations: 90 (clockwise), 180 (upside down), 270 (counter-clockwise).

        Args:
            degrees: Rotation angle in degrees.
                     Use 90 for clockwise rotation.
                     Use 180 if text is upside down.
                     Use 270 for counter-clockwise rotation.
        """
        image_data = image_data_getter()
        if image_data is None:
            return 'No image available to rotate.'

        try:
            img = Image.open(io.BytesIO(image_data))

            if degrees == 90:
                img = img.transpose(Image.Transpose.ROTATE_90)
            elif degrees == 180:
                img = img.transpose(Image.Transpose.ROTATE_180)
            elif degrees == 270:
                img = img.transpose(Image.Transpose.ROTATE_270)
            else:
                img = img.rotate(-degrees, expand=True)

            if img.mode == 'RGBA':
                img = img.convert('RGB')

            buffer = io.BytesIO()
            img.save(buffer, format='JPEG', quality=95)
            new_image_data = buffer.getvalue()

            image_data_setter(new_image_data)

            analysis_steps.append({
                'step': len(analysis_steps) + 1,
                'tool': 'rotate_image',
                'degrees': degrees,
                'result': 'Image rotated successfully'
            })

            return f'Image rotated {degrees} degrees successfully. You can now analyze the rotated image.'

        except Exception as e:
            error_msg = f'Error rotating image: {e}'
            print(error_msg)
            return error_msg

    return rotate_image
