from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Optional, List
from datetime import datetime


class Ingredient(BaseModel):
    name: str
    quantity: str
    unit: str
    is_section: Optional[bool] = False


class Recipe(BaseModel):
    recipe_name: str
    ingredients: List[Ingredient]
    instructions: Optional[str]
    prep_time: Optional[int] = Field(default=None, title="Preparation Time in minutes")
    cook_time: Optional[int] = Field(default=None, title="Cooking Time in minutes")
    servings: Optional[int] = Field(default=None, title="Number of Servings")
    cuisine: Optional[str] = Field(default=None, title="Cuisine Type")
    category: Optional[str] = Field(default=None, title="Dish category, e.g. Soup, Salad, Pasta")
    tags: Optional[str] = Field(default=None, title="Attribute tags, e.g. quick, healthy, vegan")
    image_url: Optional[str] = Field(default=None, title="Image URL for the Recipe")
    is_public: bool = False
    avg_rating: float = 0.0
    rating_count: int = 0
    created_at: Optional[datetime] = None
    user_id: str
    original_recipe_id: Optional[str] = None
    original_author_name: Optional[str] = None
    is_modified: bool = False

class GroceryItem(BaseModel):
    name: str
    quantity: str
    unit: str = ""
    category: str
    checked: bool = False

class GroceryList(BaseModel):
    user_id: str
    name: str
    items: List[GroceryItem] = []

    model_config = ConfigDict(populate_by_name=True)