"""Hello unit test module."""

from idp_v2_backend.hello import hello


def test_hello():
    """Test the hello function."""
    assert hello() == "Hello idp_v2.backend"
